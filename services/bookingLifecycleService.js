const { Booking } = require('../models/bookingModels');
const TripHistory = require('../models/tripHistoryModel');
const { haversineKm } = require('../utils/distance');
const pricingService = require('./pricingService');
const commissionService = require('./commissionService');
const walletService = require('./walletService');
const financeService = require('./financeService');
const { Commission, DriverEarnings, AdminEarnings } = require('../models/commission');
const { broadcast } = require('../sockets/utils');

async function startTrip(bookingId, startLocation) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new Error('Booking not found');
  booking.status = 'ongoing';
  booking.startedAt = new Date();
  if (startLocation) booking.startLocation = startLocation;
  await booking.save();
  await TripHistory.findOneAndUpdate(
    { bookingId: booking._id },
    {
      $setOnInsert: {
        bookingId: booking._id,
        driverId: booking.driverId,
        passengerId: booking.passengerId,
        vehicleType: booking.vehicleType,
        startedAt: booking.startedAt,
        locations: []
      }
    },
    { upsert: true, new: true }
  );
  try {
    broadcast('trip_started', {
      bookingId: String(booking._id),
      startedAt: booking.startedAt,
      startLocation
    });
  } catch (_) {}
  return booking;
}

async function updateTripLocation(bookingId, driverId, location) {
  const point = { lat: Number(location.latitude), lng: Number(location.longitude), timestamp: new Date() };
  await TripHistory.findOneAndUpdate(
    { bookingId },
    { $push: { locations: point } },
    { upsert: true }
  );
  return point;
}

function computePathDistanceKm(locations) {
  if (!Array.isArray(locations) || locations.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < locations.length; i++) {
    const a = locations[i - 1];
    const b = locations[i];
    total += haversineKm({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng });
  }
  return total;
}

async function completeTrip(bookingId, endLocation, options = {}) {
  const { surgeMultiplier = 1, discount = 0, debitPassengerWallet = false, adminUserId = process.env.ADMIN_USER_ID } = options;
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new Error('Booking not found');

  const trip = await TripHistory.findOne({ bookingId: booking._id });
  const startedAt = booking.startedAt || (trip && trip.startedAt) || new Date();
  const completedAt = new Date();

  // Determine the actual completion location to use for metrics and dropoff
  let completionLocation = null;
  if (endLocation && endLocation.latitude != null && endLocation.longitude != null) {
    completionLocation = { latitude: Number(endLocation.latitude), longitude: Number(endLocation.longitude), address: endLocation.address };
  } else if (trip && Array.isArray(trip.locations) && trip.locations.length > 0) {
    const last = trip.locations[trip.locations.length - 1];
    if (last && last.lat != null && last.lng != null) {
      completionLocation = { latitude: Number(last.lat), longitude: Number(last.lng) };
    }
  }
  if (completionLocation) {
    booking.endLocation = completionLocation;
  }

  // Compute distance
  let distanceKm = 0;
  if (trip && Array.isArray(trip.locations) && trip.locations.length >= 2) {
    distanceKm = computePathDistanceKm(trip.locations);
  } else if (booking.startLocation && completionLocation) {
    distanceKm = haversineKm(
      { latitude: booking.startLocation.latitude, longitude: booking.startLocation.longitude },
      { latitude: completionLocation.latitude, longitude: completionLocation.longitude }
    );
  } else if (booking.pickup && booking.dropoff) {
    distanceKm = haversineKm(
      { latitude: booking.pickup.latitude, longitude: booking.pickup.longitude },
      { latitude: booking.dropoff.latitude, longitude: booking.dropoff.longitude }
    );
  }

  const waitingTimeMinutes = Math.max(0, Math.round(((completedAt - new Date(startedAt)) / 60000)));

  const fare = await pricingService.calculateFare(distanceKm, waitingTimeMinutes, booking.vehicleType, surgeMultiplier, discount);
  // Get per-driver commission rate set by admin; fallback to env default
  let commissionRate = Number(process.env.COMMISSION_RATE || 15);
  if (booking.driverId) {
    const commissionDoc = await Commission.findOne({ driverId: String(booking.driverId) }).sort({ createdAt: -1 });
    if (commissionDoc && Number.isFinite(commissionDoc.percentage)) {
      commissionRate = commissionDoc.percentage;
    }
  }
  const commission = financeService.calculateCommission(fare, commissionRate);
  const driverEarnings = fare - commission;

  // Update booking
  booking.status = 'completed';
  booking.completedAt = completedAt;
  booking.fareFinal = fare;
  booking.distanceKm = distanceKm;
  booking.waitingTime = waitingTimeMinutes;
  booking.commissionAmount = commission;
  booking.driverEarnings = driverEarnings;
  // Overwrite booking.dropoff with actual completion location if available
  if (completionLocation) {
    booking.dropoff = {
      latitude: completionLocation.latitude,
      longitude: completionLocation.longitude,
      // preserve existing address if end address is not provided
      address: completionLocation.address || (booking.dropoff && booking.dropoff.address) || undefined
    };
  }
  await booking.save();

  // Wallet operations (best effort)
  try {
    if (booking.driverId) await walletService.credit(booking.driverId, driverEarnings, 'Trip earnings');
    // Deduct commission from driver package balance (driver wallet) upon trip completion
    try {
      if (booking.driverId && Number.isFinite(commission) && commission > 0) {
        const { Wallet, Transaction } = require('../models/common');
        await Wallet.updateOne(
          { userId: String(booking.driverId), role: 'driver' },
          { $inc: { balance: -commission } },
          { upsert: true }
        );
        try {
          await Transaction.create({
            userId: String(booking.driverId),
            role: 'driver',
            amount: commission,
            type: 'debit',
            method: booking.paymentMethod || 'cash',
            status: 'success',
            metadata: { bookingId: String(booking._id), reason: 'Commission deduction' }
          });
        } catch (_) {}
      }
    } catch (_) {}
  } catch (_) {}
  try {
    if (adminUserId) await walletService.credit(adminUserId, commission, 'Commission from trip');
  } catch (_) {}
  try {
    if (debitPassengerWallet && booking.passengerId) await walletService.debit(booking.passengerId, fare, 'Trip fare');
  } catch (_) {}

  // Persist trip summary
  await TripHistory.findOneAndUpdate(
    { bookingId: booking._id },
    {
      $set: {
        fare,
        distance: distanceKm,
        waitingTime: waitingTimeMinutes,
        vehicleType: booking.vehicleType,
        startedAt,
        completedAt,
        // Persist final dropoff location for this trip if available
        ...(completionLocation ? { dropoffLocation: {
          latitude: completionLocation.latitude,
          longitude: completionLocation.longitude,
          address: completionLocation.address
        } } : {}),
        commission,
        netIncome: driverEarnings
      }
    },
    { upsert: true }
  );

  // Persist earnings
  try {
    if (booking.driverId) {
      await DriverEarnings.create({
        driverId: String(booking.driverId),
        bookingId: booking._id,
        tripDate: new Date(),
        grossFare: fare,
        commissionAmount: commission,
        netEarnings: driverEarnings,
        commissionPercentage: commissionRate
      });
    }
    await AdminEarnings.create({
      bookingId: booking._id,
      tripDate: new Date(),
      grossFare: fare,
      commissionEarned: commission,
      commissionPercentage: commissionRate,
      driverId: String(booking.driverId || ''),
      passengerId: String(booking.passengerId || '')
    });
  } catch (_) {}

  // Rewards removed per finance refactor

  // Broadcast lifecycle updates for admin dashboard
  try {
    broadcast('trip_completed', {
      bookingId: String(booking._id),
      amount: fare,
      distance: distanceKm,
      waitingTime: waitingTimeMinutes,
      completedAt,
      driverEarnings,
      commission
    });
  } catch (_) {}

  return booking;
}

module.exports = { startTrip, updateTripLocation, completeTrip };

