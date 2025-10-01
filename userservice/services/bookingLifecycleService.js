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

  if (endLocation) booking.endLocation = endLocation;

  // Compute distance
  let distanceKm = 0;
  if (trip && Array.isArray(trip.locations) && trip.locations.length >= 2) {
    distanceKm = computePathDistanceKm(trip.locations);
  } else if (booking.startLocation && endLocation) {
    distanceKm = haversineKm(
      { latitude: booking.startLocation.latitude, longitude: booking.startLocation.longitude },
      { latitude: endLocation.latitude, longitude: endLocation.longitude }
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
  await booking.save();

  // Wallet operations (best effort)
  try {
    if (booking.driverId) await walletService.credit(booking.driverId, driverEarnings, 'Trip earnings');
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

