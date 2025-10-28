const geolib = require('geolib');
const mongoose = require('mongoose');
const { Booking, BookingAssignment, TripHistory } = require('../models/bookingModels');
const { Pricing } = require('../models/pricing');
const { Passenger, Driver } = require('../models/userModels');
const { DriverEarnings, AdminEarnings, Commission } = require('../models/commission');
const { Wallet, Transaction } = require('../models/common');
const positionUpdateService = require('./../services/positionUpdate');
const financeService = require('./financeService');

async function estimateFare({ vehicleType = 'mini', pickup, dropoff }) {
  const distanceKm = geolib.getDistance(
    { latitude: pickup.latitude, longitude: pickup.longitude },
    { latitude: dropoff.latitude, longitude: dropoff.longitude }
  ) / 1000;
  const p = await Pricing.findOne({ vehicleType, isActive: true }).sort({ updatedAt: -1 }) || { baseFare: 2, perKm: 1, perMinute: 0.2, waitingPerMinute: 0.1, surgeMultiplier: 1 };
  const fareBreakdown = {
    base: p.baseFare,
    distanceCost: distanceKm * p.perKm,
    timeCost: 0,
    waitingCost: 0,
    surgeMultiplier: p.surgeMultiplier,
  };
  const fareEstimated = (fareBreakdown.base + fareBreakdown.distanceCost + fareBreakdown.timeCost + fareBreakdown.waitingCost) * fareBreakdown.surgeMultiplier;
  return { distanceKm, fareEstimated, fareBreakdown };
}

async function resolvePassengerMeta(passengerId, jwtUser, authHeader) {
  let p = null;
  const { Types } = require('mongoose');
  if (Types.ObjectId.isValid(passengerId)) {
    p = await Passenger.findById(passengerId).select({ _id: 1, name: 1, phone: 1 }).lean();
  }
  const tokenMeta = jwtUser ? {
    name: jwtUser.name || jwtUser.fullName || jwtUser.displayName,
    phone: jwtUser.phone || jwtUser.phoneNumber || jwtUser.mobile,
    email: jwtUser.email
  } : {};
  let passengerName = tokenMeta.name || p?.name || undefined;
  let passengerPhone = tokenMeta.phone || p?.phone || undefined;
  if (!passengerName || !passengerPhone) {
    try {
      const { getPassengerById } = require('../integrations/userServiceClient');
      const info = await getPassengerById(passengerId, { headers: authHeader });
      if (info) {
        passengerName = passengerName || info.name;
        passengerPhone = passengerPhone || info.phone;
      }
    } catch (_) {}
  }
  if (!passengerName || !passengerPhone) {
    const err = new Error('Passenger name and phone are required from auth token or user directory');
    err.status = 422;
    throw err;
  }
  return { passengerName, passengerPhone };
}

async function createBooking({ passengerId, jwtUser, vehicleType, pickup, dropoff, authHeader, skipPassengerMeta = false }) {
  if (!pickup || !dropoff) {
    const err = new Error('Pickup and dropoff locations are required');
    err.status = 400;
    throw err;
  }
  const est = await estimateFare({ vehicleType, pickup, dropoff });
  let passengerName;
  let passengerPhone;
  if (!skipPassengerMeta) {
    const meta = await resolvePassengerMeta(passengerId, jwtUser, authHeader);
    passengerName = meta.passengerName;
    passengerPhone = meta.passengerPhone;
  }
  const booking = await Booking.create({
    passengerId,
    passengerName,
    passengerPhone,
    vehicleType,
    pickup,
    dropoff,
    distanceKm: est.distanceKm,
    fareEstimated: est.fareEstimated,
    fareBreakdown: est.fareBreakdown
  });
  
  return booking;
}

async function listBookings({ requester, headers }) {
  const userType = requester?.type;
  const userId = requester?.id;
  const query = {};
  if (userType === 'passenger') query.passengerId = String(userId);
  const rows = await Booking.find(query).sort({ createdAt: -1 }).lean();

  const { Types } = require('mongoose');
  const passengerIds = [...new Set(rows.map(r => r.passengerId))];
  const validObjectIds = passengerIds.filter(id => Types.ObjectId.isValid(id));
  const passengers = validObjectIds.length
    ? await Passenger.find({ _id: { $in: validObjectIds } }).select({ _id: 1, name: 1, phone: 1 }).lean()
    : [];
  const pidToPassenger = Object.fromEntries(passengers.map(p => [String(p._id), { id: String(p._id), name: p.name, phone: p.phone }]));

  const nonObjectIdPassengerIds = passengerIds.filter(id => !Types.ObjectId.isValid(id));
  let additionalPassengers = {};
  if (nonObjectIdPassengerIds.length > 0) {
    try {
      const { getPassengerById } = require('../integrations/userServiceClient');
      const additionalPassengerResults = await Promise.all(nonObjectIdPassengerIds.map(async (id) => {
        try {
          const info = await getPassengerById(id, { headers });
          return info ? { id, info } : null;
        } catch (_) { return null; }
      }));
      additionalPassengers = Object.fromEntries(additionalPassengerResults.filter(Boolean).map(r => [r.id, { id: r.id, name: r.info.name, phone: r.info.phone }]));
    } catch (_) {}
  }

  let jwtPassengerInfo = null;
  if (requester && requester.id && requester.type === 'passenger') {
    jwtPassengerInfo = {
      id: String(requester.id),
      name: requester.name || requester.fullName || requester.displayName,
      phone: requester.phone || requester.phoneNumber || requester.mobile,
      email: requester.email
    };
  }

  const authHeader = headers && headers.authorization ? { Authorization: headers.authorization } : undefined;
  const driverIds = [...new Set(rows.map(r => r.driverId).filter(Boolean))];
  let driverInfoMap = {};
  if (driverIds.length) {
    try {
      const { getDriversByIds } = require('../integrations/userServiceClient');
      const infos = await getDriversByIds(driverIds, { headers: authHeader });
      driverInfoMap = Object.fromEntries((infos || []).map(i => [String(i.id), { id: String(i.id), name: i.name, phone: i.phone }]));
    } catch (_) {}
  }

  const normalized = rows.map(b => {
    let passenger = undefined;
    if (jwtPassengerInfo && String(jwtPassengerInfo.id) === String(b.passengerId)) {
      passenger = jwtPassengerInfo;
    } else if (b.passengerName || b.passengerPhone) {
      passenger = { id: b.passengerId, name: b.passengerName, phone: b.passengerPhone };
    } else if (pidToPassenger[b.passengerId]) {
      passenger = pidToPassenger[b.passengerId];
    } else if (additionalPassengers[b.passengerId]) {
      passenger = additionalPassengers[b.passengerId];
    }
    const driverBasic = b.driverId ? driverInfoMap[String(b.driverId)] || undefined : undefined;
    return {
      id: String(b._id),
      passengerId: b.passengerId,
      passenger,
      driverId: b.driverId,
      driver: driverBasic,
      vehicleType: b.vehicleType,
      pickup: b.pickup,
      dropoff: b.dropoff,
      distanceKm: b.distanceKm,
      fareEstimated: b.fareEstimated,
      fareFinal: b.fareFinal,
      fareBreakdown: b.fareBreakdown,
      status: b.status,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt
    };
  });
  return normalized;
}

async function getBooking({ requester, id }) {
  const userType = requester?.type;
  const query = { _id: id };
  if (userType === 'passenger') query.passengerId = String(requester?.id);
  const item = await Booking.findOne(query).lean();
  if (!item) {
    const err = new Error('Booking not found or you do not have permission to access it');
    err.status = 404;
    throw err;
  }
  const { Types } = require('mongoose');
  let passenger = undefined;
  if (requester && requester.id && requester.type === 'passenger' && String(requester.id) === String(item.passengerId)) {
    passenger = {
      id: String(requester.id),
      name: requester.name || requester.fullName || requester.displayName,
      phone: requester.phone || requester.phoneNumber || requester.mobile,
      email: requester.email
    };
  }
  if (!passenger && item.passengerId && Types.ObjectId.isValid(item.passengerId)) {
    const p = await Passenger.findById(item.passengerId).select({ _id: 1, name: 1, phone: 1 }).lean();
    if (p) passenger = { id: String(p._id), name: p.name, phone: p.phone };
  }
  if (!passenger && (item.passengerName || item.passengerPhone)) {
    passenger = { id: String(item.passengerId), name: item.passengerName, phone: item.passengerPhone };
  }
  if (!passenger) {
    passenger = { id: String(item.passengerId), name: `Passenger ${item.passengerId}`, phone: `+123456789${item.passengerId}` };
  }
  return {
    id: String(item._id),
    passengerId: item.passengerId,
    passenger,
    vehicleType: item.vehicleType,
    pickup: item.pickup,
    dropoff: item.dropoff,
    distanceKm: item.distanceKm,
    fareEstimated: item.fareEstimated,
    fareFinal: item.fareFinal,
    fareBreakdown: item.fareBreakdown,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

async function updateBookingLifecycle({ requester, id, status }) {
  const requesterType = String(requester?.type || '').toLowerCase();
  let booking = await Booking.findById(id);
  try { require('../utils/logger').info('[lifecycle] start', { id: String(id), requesterType, status, current: booking && booking.status }); } catch (_) {}
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  if (!['requested','accepted','ongoing','completed','canceled'].includes(status)) {
    const err = new Error(`Invalid status '${status}'. Allowed values: requested, accepted, ongoing, completed, canceled`);
    err.status = 400;
    throw err;
  }
  if (booking.status === 'completed') {
    const err = new Error('Cannot change status of completed bookings');
    err.status = 400;
    throw err;
  }
  if (status === 'accepted' && requesterType === 'driver') {
    const driver = await Driver.findById(requester.id);
    if (!driver || !driver.available) {
      const err = new Error('Driver must be available to accept bookings. Driver is currently unavailable.');
      err.status = 400;
      throw err;
    }
    const activeBooking = await Booking.findOne({ driverId: requester.id, status: { $in: ['accepted', 'ongoing'] } });
    if (activeBooking) {
      const err = new Error('Driver already has an active booking');
      err.status = 400;
      throw err;
    }
    // Finance rule: ensure driver has enough package balance to accept
    try {
      const wallet = await Wallet.findOne({ userId: String(requester.id), role: 'driver' });
      const packageBalance = wallet ? Number(wallet.balance || 0) : 0;
      const targetFare = booking.fareFinal || booking.fareEstimated || 0;
      if (!financeService.canAcceptBooking(packageBalance, targetFare)) {
        const err = new Error('Insufficient package balance to accept booking');
        err.status = 403;
        throw err;
      }
    } catch (e) {
      if (e && e.status) throw e;
    }

    // Perform atomic conditional accept to avoid races
    const now = new Date();
    const updated = await Booking.findOneAndUpdate(
      { _id: id, status: 'requested' },
      { $set: { driverId: String(requester.id), status: 'accepted', acceptedAt: now } },
      { new: true }
    );
    if (!updated) {
      const err = new Error('Booking is no longer available to accept');
      err.status = 409;
      throw err;
    }
    booking = updated;
    await Driver.findByIdAndUpdate(requester.id, { available: false });
    try { require('../utils/logger').info('[lifecycle] accepted-atomic', { id: String(booking._id), status: booking.status, driverId: booking.driverId }); } catch (_) {}
  }
  if (requesterType === 'driver' && booking.driverId && booking.driverId !== String(requester.id)) {
    const err = new Error('Only the assigned driver can change this booking status');
    err.status = 403;
    throw err;
  }
  // If accepted via atomic update above, skip redundant mutation
  if (!(status === 'accepted' && requesterType === 'driver')) {
    booking.status = status;
    if (status === 'accepted') booking.acceptedAt = new Date();
  }
  if (status === 'ongoing') {
    booking.startedAt = new Date();
    if (booking.driverId && booking.passengerId) {
      positionUpdateService.startTracking(booking._id.toString(), booking.driverId, booking.passengerId);
    }
  }
  if (status === 'completed') {
    booking.completedAt = new Date();
    booking.fareFinal = booking.fareEstimated;
    if (booking.driverId) {
      const commission = await Commission.findOne({ driverId: String(booking.driverId) }).sort({ createdAt: -1 });
      const commissionRate = commission && Number.isFinite(commission.percentage) ? commission.percentage : Number(process.env.COMMISSION_RATE || 15);
      const grossFare = booking.fareFinal || booking.fareEstimated;
      const commissionAmount = financeService.calculateCommission(grossFare, commissionRate);
      const netEarnings = financeService.calculateNetIncome(grossFare, commissionRate);
      await DriverEarnings.create({
        driverId: booking.driverId,
        bookingId: booking._id,
        tripDate: new Date(),
        grossFare,
        commissionAmount,
        netEarnings,
        commissionPercentage: commissionRate
      });
      try {
        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
          await Wallet.updateOne(
            { userId: String(booking.driverId), role: 'driver' },
            { $inc: { balance: netEarnings, totalEarnings: netEarnings } },
            { upsert: true, session }
          );
          await Transaction.create([
            {
              userId: String(booking.driverId),
              role: 'driver',
              amount: netEarnings,
              type: 'credit',
              method: booking.paymentMethod || 'cash',
              status: 'success',
              metadata: { bookingId: String(booking._id), reason: 'Trip earnings (REST)' }
            }
          ], { session });
        });
        session.endSession();
      } catch (_) {}
      await AdminEarnings.create({
        bookingId: booking._id,
        tripDate: new Date(),
        grossFare,
        commissionEarned: commissionAmount,
        commissionPercentage: commissionRate,
        driverId: booking.driverId,
        passengerId: booking.passengerId
      });
      await Driver.findByIdAndUpdate(booking.driverId, { available: true });
      positionUpdateService.stopTracking(booking._id.toString());
    }
  }
  if (status === 'canceled') {
    if (booking.driverId) await Driver.findByIdAndUpdate(booking.driverId, { available: true });
    positionUpdateService.stopTracking(booking._id.toString());
  }
  // For atomic accept we already persisted changes
  if (!(status === 'accepted' && requesterType === 'driver')) {
    await booking.save();
    try { require('../utils/logger').info('[lifecycle] saved', { id: String(booking._id), status: booking.status }); } catch (_) {}
  }
  
  await TripHistory.create({ bookingId: booking._id, driverId: booking.driverId, passengerId: booking.passengerId, status: booking.status });
  try { require('../utils/logger').info('[lifecycle] done', { id: String(booking._id), status: booking.status, driverId: booking.driverId }); } catch (_) {}
  return booking;
}

async function assignDriver({ bookingId, driverId, dispatcherId, passengerId }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  if (booking.status !== 'requested') {
    const err = new Error(`Cannot assign booking with status '${booking.status}'. Only 'requested' bookings can be assigned.`);
    err.status = 400;
    throw err;
  }
  const driver = await Driver.findById(driverId);
  if (!driver || !driver.available) {
    const err = new Error('Driver is not available for assignment. Driver must be available to accept bookings.');
    err.status = 400;
    throw err;
  }
  const activeBooking = await Booking.findOne({ driverId: String(driverId), status: { $in: ['accepted', 'ongoing'] } });
  if (activeBooking) {
    const err = new Error('Driver already has an active booking');
    err.status = 400;
    throw err;
  }
  // Finance rule: check driver's package balance before assignment
  try {
    const wallet = await Wallet.findOne({ userId: String(driverId), role: 'driver' });
    const packageBalance = wallet ? Number(wallet.balance || 0) : 0;
    const targetFare = booking.fareFinal || booking.fareEstimated || 0;
    if (!financeService.canAcceptBooking(packageBalance, targetFare)) {
      const err = new Error('Driver cannot be assigned due to insufficient package balance');
      err.status = 403;
      throw err;
    }
  } catch (e) {
    if (e && e.status) throw e;
  }
  const assignment = await BookingAssignment.create({ bookingId, driverId: String(driverId), dispatcherId: String(dispatcherId), passengerId: String(passengerId || booking.passengerId) });
  booking.driverId = String(driverId);
  booking.status = 'accepted';
  booking.acceptedAt = new Date();
  await booking.save();
  await Driver.findByIdAndUpdate(driverId, { available: false });
  return { booking, assignment };
}

async function listNearbyBookings({ latitude, longitude, radiusKm = 5, vehicleType, limit = 20, driverId, headers }) {
  const query = { status: 'requested', ...(vehicleType ? { vehicleType } : {}) };
  const rows = await Booking.find(query).sort({ createdAt: -1 }).lean();
  const withDistance = rows.map(b => {
    const dKm = geolib.getDistance(
      { latitude, longitude },
      { latitude: b.pickup?.latitude, longitude: b.pickup?.longitude }
    ) / 1000;
    return { booking: b, distanceKm: dKm };
  }).filter(x => isFinite(x.distanceKm) && x.distanceKm <= radiusKm);
  withDistance.sort((a, b) => a.distanceKm - b.distanceKm);
  // Finance rule: optionally filter out bookings the driver cannot afford (package balance)
  let filtered = withDistance;
  if (driverId) {
    try {
      const wallet = await Wallet.findOne({ userId: String(driverId), role: 'driver' });
      const packageBalance = wallet ? Number(wallet.balance || 0) : 0;
      filtered = withDistance.filter(x => financeService.canAcceptBooking(packageBalance, x.booking.fareFinal || x.booking.fareEstimated || 0));
    } catch (_) {}
  }
  const selected = filtered.slice(0, Math.min(parseInt(limit, 10) || 20, 100));
  // Attempt to enrich passenger info for drivers if missing on booking
  let passengerInfoMap = {};
  try {
    const missingPassengerIds = [...new Set(selected
      .map(x => x.booking)
      .filter(b => b && (!b.passengerName || !b.passengerPhone))
      .map(b => String(b.passengerId))
      .filter(Boolean))];
    if (missingPassengerIds.length) {
      const { getPassengerById } = require('../integrations/userServiceClient');
      const authHeader = headers && headers.authorization ? { Authorization: headers.authorization } : undefined;
      const lookups = await Promise.all(missingPassengerIds.map(async (pid) => {
        try {
          const info = await getPassengerById(pid, { headers: authHeader });
          return info ? [pid, { id: pid, name: info.name, phone: info.phone }] : null;
        } catch (_) { return null; }
      }));
      passengerInfoMap = Object.fromEntries(lookups.filter(Boolean));
    }
  } catch (_) {}

  return selected.map(x => ({
    id: String(x.booking._id),
    passengerId: x.booking.passengerId,
    passenger: (x.booking.passengerName || x.booking.passengerPhone)
      ? { id: x.booking.passengerId, name: x.booking.passengerName, phone: x.booking.passengerPhone }
      : (passengerInfoMap[String(x.booking.passengerId)] || undefined),
    vehicleType: x.booking.vehicleType,
    pickup: x.booking.pickup,
    dropoff: x.booking.dropoff,
    distanceKm: Math.round(x.distanceKm * 100) / 100,
    fareEstimated: x.booking.fareEstimated,
    status: x.booking.status,
    createdAt: x.booking.createdAt,
    updatedAt: x.booking.updatedAt
  }));
}

async function ratePassenger({ bookingId, driverId, rating, comment }) {
  if (!rating || rating < 1 || rating > 5) {
    const err = new Error('Rating must be between 1 and 5');
    err.status = 400;
    throw err;
  }
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  if (String(booking.driverId) !== String(driverId)) {
    const err = new Error('Only the assigned driver can rate the passenger');
    err.status = 403;
    throw err;
  }
  if (booking.status !== 'completed') {
    const err = new Error('Can only rate after trip completion');
    err.status = 400;
    throw err;
  }
  booking.passengerRating = rating;
  if (comment) booking.passengerComment = comment;
  await booking.save();
  return { booking, rating, comment };
}

async function rateDriver({ bookingId, passengerId, rating, comment }) {
  if (!rating || rating < 1 || rating > 5) {
    const err = new Error('Rating must be between 1 and 5');
    err.status = 400;
    throw err;
  }
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  if (String(booking.passengerId) !== String(passengerId)) {
    const err = new Error('Only the passenger can rate the driver');
    err.status = 403;
    throw err;
  }
  if (booking.status !== 'completed') {
    const err = new Error('Can only rate after trip completion');
    err.status = 400;
    throw err;
  }
  booking.driverRating = rating;
  if (comment) booking.driverComment = comment;
  await booking.save();
  return { message: 'Driver rated successfully' };
}

module.exports = {
  estimateFare,
  createBooking,
  listBookings,
  getBooking,
  updateBookingLifecycle,
  assignDriver,
  listNearbyBookings,
  ratePassenger,
  rateDriver
};

