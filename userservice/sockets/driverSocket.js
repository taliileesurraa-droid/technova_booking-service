const driverService = require('../services/driverService');
const driverEvents = require('../events/driverEvents');
const logger = require('../utils/logger');
const { markDispatched, wasDispatched } = require('./dispatchRegistry');

module.exports = (io, socket) => {
  // On connection, send initial nearby unassigned bookings (pre-existing) and current driver bookings
  try {
    if (socket.user && String(socket.user.type).toLowerCase() === 'driver') {
      // Join driver-specific room so targeted events like booking:new and booking:removed are received
      try {
        const driverRoom = `driver:${String(socket.user.id)}`;
        socket.join(driverRoom);
      } catch (_) {}
      (async () => {
        try {
          const { Booking } = require('../models/bookingModels');
          const { Driver } = require('../models/userModels');
          const { Wallet } = require('../models/common');
          const financeService = require('../services/financeService');
          const geolib = require('geolib');

          const driverId = String(socket.user.id);
          const me = await Driver.findById(driverId).lean();
          const radiusKm = parseFloat(process.env.BROADCAST_RADIUS_KM || process.env.RADIUS_KM || '5');

          // Current bookings assigned to this driver
          const currentRows = await Booking.find({ driverId, status: { $in: ['accepted', 'ongoing', 'requested'] } })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

          const currentBookings = currentRows.map(b => ({
            id: String(b._id),
            status: b.status,
            pickup: b.pickup,
            dropoff: b.dropoff,
            fareEstimated: b.fareEstimated,
            fareFinal: b.fareFinal,
            distanceKm: b.distanceKm,
            passenger: b.passengerId ? { id: String(b.passengerId), name: b.passengerName, phone: b.passengerPhone } : undefined,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
            patch: {
              status: b.status,
              passengerId: String(b.passengerId || ''),
              vehicleType: b.vehicleType,
              pickup: b.pickup,
              dropoff: b.dropoff,
              passenger: b.passengerId ? { id: String(b.passengerId), name: b.passengerName, phone: b.passengerPhone } : undefined
            }
          }));

          // Nearby unassigned requested bookings created before connection
let nearby = [];
try {
  if (me && me.lastKnownLocation && Number.isFinite(me.lastKnownLocation.latitude) && Number.isFinite(me.lastKnownLocation.longitude)) {
    const open = await Booking.find({ status: 'requested', $or: [{ driverId: { $exists: false } }, { driverId: null }, { driverId: '' }] })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    const withDistance = open.map(b => ({
      booking: b,
      distanceKm: geolib.getDistance(
        { latitude: me.lastKnownLocation.latitude, longitude: me.lastKnownLocation.longitude },
        { latitude: b.pickup?.latitude, longitude: b.pickup?.longitude }
      ) / 1000
    }))
      .filter(x => Number.isFinite(x.distanceKm) && x.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    // Filter by package affordability
    const w = await Wallet.findOne({ userId: driverId, role: 'driver' }).lean();
    const balance = w ? Number(w.balance || 0) : 0;
    nearby = withDistance
      .filter(x => financeService.canAcceptBooking(balance, x.booking.fareFinal || x.booking.fareEstimated || 0))
      .slice(0, 50)
      .map(x => ({
        id: String(x.booking._id),
        status: x.booking.status,
        pickup: x.booking.pickup,
        dropoff: x.booking.dropoff,
        fareEstimated: x.booking.fareEstimated,
        fareFinal: x.booking.fareFinal,
        distanceKm: Math.round(x.distanceKm * 100) / 100,
        passenger: x.booking.passengerId ? { id: String(x.booking.passengerId), name: x.booking.passengerName, phone: x.booking.passengerPhone } : undefined,
        createdAt: x.booking.createdAt,
        updatedAt: x.booking.updatedAt
      }));

    // Mark initial snapshot items as dispatched (no logs) to avoid duplicate booking:new per driver
    try {
      const driverId = String(me._id);
      nearby.forEach(b => { if (!wasDispatched(b.id, driverId)) markDispatched(b.id, driverId); });
    } catch (_) {}
  }
} catch (_) {}

          const payload = {
            init: true,
            driverId,
            bookings: nearby,
            currentBookings,
            user: { id: driverId, type: 'driver' }
          };
          try { logger.info('[socket->driver] emit booking:nearby ', { sid: socket.id, userId: driverId, nearbyCount: payload.bookings.length, currentCount: payload.currentBookings.length }); } catch (_) {}
          socket.emit('booking:nearby', payload);
        } catch (_) {}
      })();
    }
  } catch (_) {}

  // driver:availability
  socket.on('driver:availability', async (payload) => {
    try { logger.info('[socket<-driver] driver:availability', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver') {
        return socket.emit('booking_error', { message: 'Unauthorized: driver token required', source: 'driver:availability' });
      }
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const available = typeof data.available === 'boolean' ? data.available : undefined;
      if (available == null) return socket.emit('booking_error', { message: 'available boolean is required', source: 'driver:availability' });
      const updated = await driverService.setAvailability(String(socket.user.id), available, socket.user);
      driverEvents.emitDriverAvailability(String(socket.user.id), !!available);
      try { logger.info('[socket->driver] availability updated', { userId: socket.user && socket.user.id, available }); } catch (_) {}
    } catch (err) {
      socket.emit('booking_error', { message: 'Failed to update availability', source: 'driver:availability' });
    }
  });

  // booking:driver_location_update
  socket.on('booking:driver_location_update', async (payload) => {
    try { logger.info('[socket<-driver] booking:driver_location_update', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver') {
        return socket.emit('booking_error', { message: 'Unauthorized: driver token required', source: 'booking:driver_location_update' });
      }
      const raw = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const data = {
        latitude: raw.latitude != null ? Number(raw.latitude) : undefined,
        longitude: raw.longitude != null ? Number(raw.longitude) : undefined,
        bearing: raw.bearing != null ? Number(raw.bearing) : undefined
      };
      if (!Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) {
        return socket.emit('booking_error', { message: 'latitude and longitude must be numbers', source: 'booking:driver_location_update' });
      }
      const d = await driverService.updateLocation(String(socket.user.id), data, socket.user);
      driverEvents.emitDriverLocationUpdate({
        driverId: String(d._id),
        vehicleType: d.vehicleType,
        available: d.available,
        lastKnownLocation: { latitude: d.lastKnownLocation?.latitude, longitude: d.lastKnownLocation?.longitude, bearing: d.lastKnownLocation?.bearing },
        updatedAt: d.updatedAt
      });
      try { logger.info('[socket->broadcast] driver location updated', { userId: socket.user && socket.user.id, lat: d.lastKnownLocation?.latitude, lon: d.lastKnownLocation?.longitude }); } catch (_) {}
    } catch (err) {
      socket.emit('booking_error', { message: 'Failed to process location update', source: 'booking:driver_location_update' });
    }
  });
};

