const bookingService = require('../services/bookingService');
const errorHandler = require('../utils/errorHandler');
const bookingEvents = require('../events/bookingEvents');

exports.create = async (req, res) => {
  try {
    const passengerId = String(req.user?.id);
    if (!passengerId) return res.status(400).json({ message: 'Invalid passenger ID: user not authenticated' });
    const { vehicleType, pickup, dropoff } = req.body;
    const booking = await bookingService.createBooking({
      passengerId,
      jwtUser: req.user,
      vehicleType,
      pickup,
      dropoff,
      authHeader: req.headers && req.headers.authorization ? { Authorization: req.headers.authorization } : undefined
    });
    const data = {
      id: String(booking._id),
      passengerId,
      passenger: { id: passengerId, name: booking.passengerName, phone: booking.passengerPhone },
      vehicleType: booking.vehicleType,
      pickup: booking.pickup,
      dropoff: booking.dropoff,
      distanceKm: booking.distanceKm,
      fareEstimated: booking.fareEstimated,
      fareFinal: booking.fareFinal,
      fareBreakdown: booking.fareBreakdown,
      status: booking.status,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt
    };
    try {
      const { nearestPassengers } = require('../services/nearbyPassengers');
      const nearest = await nearestPassengers({ latitude: booking.pickup.latitude, longitude: booking.pickup.longitude, limit: 5 });
      const targets = (nearest || []).map(x => x.passenger);
      bookingEvents.emitBookingCreatedToNearestPassengers({ ...data }, targets);
    } catch (_) {}
    return res.status(201).json(data);
  } catch (e) { errorHandler(res, e); }
}

exports.list = async (req, res) => {
  try {
    const rows = await bookingService.listBookings({ requester: req.user, headers: req.headers || {} });
    return res.json(rows);
  } catch (e) { errorHandler(res, e); }
}

exports.get = async (req, res) => {
  try {
    const item = await bookingService.getBooking({ requester: req.user, id: req.params.id });
    return res.json(item);
  } catch (e) { errorHandler(res, e); }
}

exports.update = async (req, res) => {
  try {
    // Keep generic update simple (non-core business logic)
    const { Booking } = require('../models/bookingModels');
    const updated = await Booking.findOneAndUpdate({ _id: req.params.id, passengerId: String(req.user?.id) }, req.body, { new: true });
    if (!updated) return res.status(404).json({ message: 'Booking not found or you do not have permission to update it' });
    return res.json(updated);
  } catch (e) { errorHandler(res, e); }
}

exports.remove = async (req, res) => {
  try { 
    const { Booking } = require('../models/bookingModels');
    const r = await Booking.findOneAndDelete({ _id: req.params.id, passengerId: String(req.user?.id) }); 
    if (!r) return res.status(404).json({ message: 'Booking not found or you do not have permission to delete it' }); 
    return res.status(204).send(); 
  } catch (e) { errorHandler(res, e); }
}

exports.lifecycle = async (req, res) => {
  try {
    const { status } = req.body;
    const booking = await bookingService.updateBookingLifecycle({ requester: req.user, id: req.params.id, status });
    bookingEvents.emitBookingUpdate(String(booking._id || booking.id), { status });
    return res.json(booking);
  } catch (e) { errorHandler(res, e); }
}

exports.assign = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const { driverId, dispatcherId, passengerId } = req.body;
    if (!driverId) return res.status(400).json({ message: 'Driver ID is required for assignment' });
    if (!dispatcherId) return res.status(400).json({ message: 'Dispatcher ID is required for assignment' });
    const result = await bookingService.assignDriver({ bookingId, driverId, dispatcherId, passengerId });
    bookingEvents.emitBookingAssigned(String(bookingId), String(driverId));
    return res.json(result);
  } catch (e) { errorHandler(res, e); }
}

exports.estimate = async (req, res) => {
  try {
    const { vehicleType, pickup, dropoff } = req.body;
    const est = await bookingService.estimateFare({ vehicleType, pickup, dropoff });
    return res.json(est);
  } catch (e) { errorHandler(res, e); }
}

// GET /v1/bookings/nearby?latitude=...&longitude=...&radiusKm=5&vehicleType=mini&limit=20
exports.nearby = async (req, res) => {
  try {
    const userType = req.user && req.user.type;
    if (!['driver','admin','staff','superadmin'].includes(String(userType || ''))) {
      return res.status(403).json({ message: 'Only drivers or staff can view nearby bookings' });
    }
    const latitude = parseFloat(req.query.latitude);
    const longitude = parseFloat(req.query.longitude);
    const radiusKm = parseFloat(req.query.radiusKm || '5');
    const vehicleType = req.query.vehicleType || undefined;
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    if (!isFinite(latitude) || !isFinite(longitude)) {
      return res.status(400).json({ message: 'Valid latitude and longitude are required' });
    }
    const result = await bookingService.listNearbyBookings({ latitude, longitude, radiusKm, vehicleType, limit, driverId: req.user && req.user.type === 'driver' ? String(req.user.id) : undefined });
    return res.json(result);
  } catch (e) { errorHandler(res, e); }
}

// Rate passenger (driver rates passenger after trip completion)
exports.ratePassenger = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const bookingId = req.params.id;
    const driverId = req.user.id;
    const result = await bookingService.ratePassenger({ bookingId, driverId, rating, comment });
    return res.json({ message: 'Passenger rated successfully', ...result });
  } catch (e) { errorHandler(res, e); }
}

// Rate driver (passenger rates driver after trip completion)
exports.rateDriver = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const bookingId = req.params.id;
    const passengerId = req.user.id;
    const result = await bookingService.rateDriver({ bookingId, passengerId, rating, comment });
    return res.json(result);
  } catch (e) { errorHandler(res, e); }
}