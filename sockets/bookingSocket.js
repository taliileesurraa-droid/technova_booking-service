const bookingService = require('../services/bookingService');
const bookingEvents = require('../events/bookingEvents');
const { sendMessageToSocketId } = require('./utils');
const lifecycle = require('../services/bookingLifecycleService');
const { markDispatched, wasDispatched } = require('./dispatchRegistry');
const { wasEmitted, markEmitted } = require('./emitOnce');
const logger = require('../utils/logger');
const { Booking } = require('../models/bookingModels');

// Dedup moved to shared registry

module.exports = (io, socket) => {
  // booking:join_room - allow user to join booking room to receive events
  socket.on('booking:join_room', async (payload) => {
    try { logger.info('[socket<-user] booking:join_room', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const bookingId = String(data.bookingId || '');
      if (!bookingId) return socket.emit('booking_error', { message: 'bookingId is required', source: 'booking:join_room' });
      const room = `booking:${bookingId}`;
      socket.join(room);
      try { logger.info('[socket->room] joined', { room, userId: socket.user && socket.user.id }); } catch (_) {}
      socket.emit('booking:joined', { bookingId });
    } catch (err) {
      socket.emit('booking_error', { message: 'Failed to join booking room', source: 'booking:join_room' });
    }
  });
  // booking_request (create booking)
  socket.on('booking_request', async (payload) => {
    try { logger.info('[socket<-passenger] booking_request', { sid: socket.id, userId: socket.user && socket.user.id }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'passenger') {
        return socket.emit('booking_error', { message: 'Unauthorized: passenger token required' });
      }
      const passengerId = String(socket.user.id);
      const booking = await bookingService.createBooking({
        passengerId,
        jwtUser: socket.user,
        vehicleType: data.vehicleType || 'mini',
        pickup: data.pickup,
        dropoff: data.dropoff,
        authHeader: socket.authToken ? { Authorization: socket.authToken } : undefined
      });
      const bookingRoom = `booking:${String(booking._id)}`;
      socket.join(bookingRoom);
      const createdPayload = { id: String(booking._id), bookingId: String(booking._id) };
      try { logger.info('[socket->passenger] booking:created', { sid: socket.id, userId: socket.user && socket.user.id, bookingId: createdPayload.bookingId }); } catch (_) {}
      socket.emit('booking:created', createdPayload);

      // Select the nearest driver who can accept (has sufficient package balance)
      try {
        const { Driver } = require('../models/userModels');
        const geolib = require('geolib');
        const { Wallet } = require('../models/common');
        const financeService = require('../services/financeService');

        const radiusKm = parseFloat(process.env.BROADCAST_RADIUS_KM || process.env.RADIUS_KM || '5');
        // Do not rely on DB availability; socket-level availability filter is applied later
        const drivers = await Driver.find(booking.vehicleType ? { vehicleType: booking.vehicleType } : {}).lean();

        const { getLiveLocation } = require('./dispatchRegistry');
        const withDistance = drivers.map(d => {
          const live = getLiveLocation(String(d._id));
          const base = live && live.latitude != null && live.longitude != null
            ? { latitude: live.latitude, longitude: live.longitude }
            : (d.lastKnownLocation && d.lastKnownLocation.latitude != null && d.lastKnownLocation.longitude != null
              ? { latitude: d.lastKnownLocation.latitude, longitude: d.lastKnownLocation.longitude }
              : null);
          const distKm = base
            ? (geolib.getDistance(base, { latitude: booking.pickup.latitude, longitude: booking.pickup.longitude }) / 1000)
            : Number.POSITIVE_INFINITY;
          return { driver: d, distanceKm: distKm };
        })
        .filter(x => Number.isFinite(x.distanceKm) && x.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm);

        // Broadcast to top-N nearest available drivers WITH finance filter
        const maxDrivers = parseInt(process.env.BROADCAST_MAX_DRIVERS || '50', 10);
        const targetFare = booking.fareFinal || booking.fareEstimated || 0;
        const financeEligibleDrivers = [];
        for (const item of withDistance) {
          try {
            const w = await Wallet.findOne({ userId: String(item.driver._id), role: 'driver' }).lean();
            const balance = w ? Number(w.balance || 0) : 0;
            if (financeService.canAcceptBooking(balance, targetFare)) {
              financeEligibleDrivers.push(item.driver);
            }
          } catch (_) {}
          if (financeEligibleDrivers.length >= 200) break; // soft cap to prevent huge arrays
        }
        const targetDrivers = financeEligibleDrivers.slice(0, Math.max(1, Math.min(maxDrivers, 200)));

        // Filter by runtime socket-level availability (driver toggled availability on this connection)
        try {
          const { isDriverAvailableBySocket } = require('./dispatchRegistry');
          if (targetDrivers && targetDrivers.length) {
            const filtered = [];
            for (const drv of targetDrivers) {
              if (isDriverAvailableBySocket(String(drv._id))) filtered.push(drv);
            }
            if (filtered.length) {
              targetDrivers.length = 0;
              filtered.forEach(d => targetDrivers.push(d));
            }
          }
        } catch (_) {}

        if (targetDrivers && targetDrivers.length) {
          // Keep passenger format as original: { id, name, phone }
          let passengerForDriver = { id: passengerId, name: socket.user.name, phone: socket.user.phone };
          try {
            const { Passenger } = require('../models/userModels');
            const pdoc = await Passenger.findById(passengerId).select({ _id: 1, name: 1, phone: 1 }).lean();
            if (pdoc) passengerForDriver = { id: String(pdoc._id), name: pdoc.name, phone: pdoc.phone };
          } catch (_) {}

          const bookingDetails = {
            id: String(booking._id),
            status: 'requested',
            passengerId,
            passenger: passengerForDriver,
            vehicleType: booking.vehicleType,
            pickup: booking.pickup,
            dropoff: booking.dropoff,
            fareEstimated: booking.fareEstimated,
            fareFinal: booking.fareFinal,
            distanceKm: booking.distanceKm,
            createdAt: booking.createdAt,
            updatedAt: booking.updatedAt
          };
          const patch = {
            status: 'requested',
            passengerId,
            vehicleType: booking.vehicleType,
            pickup: booking.pickup,
            dropoff: booking.dropoff,
            passenger: passengerForDriver
          };
          const payloadForDriver = { id: String(booking._id), bookingId: String(booking._id), booking: bookingDetails, patch, user: { id: passengerId, type: 'passenger' } };
          // Also prepare a broadcast payload for the shared 'drivers' room as a fallback delivery channel
          const payloadForDriversRoom = { id: String(booking._id), bookingId: String(booking._id), booking: bookingDetails, patch };
          let sentCount = 0;
          for (const drv of targetDrivers) {
            const driverId = String(drv._id);
            // Do not attach extra fields; keep original format
            const channel = `driver:${driverId}`;
            if (!wasDispatched(String(booking._id), driverId)) {
              sendMessageToSocketId(channel, { event: 'booking:new', data: payloadForDriver });
              // Also emit incremental nearby update with the same schema as initial snapshot
              try { io.to(channel).emit('booking:nearby', { init: false, driverId, bookings: [bookingDetails], currentBookings: [], user: { id: driverId, type: 'driver' } }); } catch (_) {}
              markDispatched(String(booking._id), driverId);
              sentCount++;
            }
          }
          // Fallback broadcast to all connected drivers to reduce missed deliveries
          try { io.to('drivers').emit('booking:new', payloadForDriversRoom); } catch (_) {}
          try { logger.info('[socket->drivers] booking:new broadcast', { bookingId: String(booking._id), sent: sentCount, considered: targetDrivers.length }); } catch (_) {}
        } else {
          try { logger.info('[socket->drivers] no eligible driver (package/distance)', { bookingId: String(booking._id) }); } catch (_) {}
        }
      } catch (err) { try { logger.error('[booking_request] broadcast error', err); } catch (_) {} }
    } catch (err) {
      socket.emit('booking_error', { message: 'Failed to create booking' });
    }
  });

  // booking_accept
  socket.on('booking_accept', async (payload) => {
    try { logger.info('[socket<-driver] booking_accept', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const bookingId = String(data.bookingId || '');
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver' || !socket.user.id) {
        return socket.emit('booking_error', { message: 'Unauthorized: driver token required', bookingId });
      }
      if (!bookingId) return socket.emit('booking_error', { message: 'bookingId is required' });

      // Only allow accept transition via lifecycle update in service
      const updated = await bookingService.updateBookingLifecycle({ requester: { ...socket.user, type: String(socket.user.type || '').toLowerCase() }, id: bookingId, status: 'accepted' });
      try { logger.info('[booking_accept] lifecycle updated', { bookingId: String(updated._id), status: updated.status, driverId: updated.driverId }); } catch (_) {}
      const room = `booking:${String(updated._id)}`;
      socket.join(room);
      bookingEvents.emitBookingUpdate(String(updated._id), { status: 'accepted', driverId: String(socket.user.id), acceptedAt: updated.acceptedAt });
      try { logger.info('[socket->room] booking:update accepted', { bookingId: String(updated._id), driverId: String(socket.user.id) }); } catch (_) {}

      // Emit explicit booking_accept with enriched driver and booking details to booking room
      try {
        const { Driver } = require('../models/userModels');
        const { Passenger } = require('../models/userModels');
        const d = await Driver.findById(String(socket.user.id)).lean();
        const bfull = await Booking.findById(String(updated._id)).lean();
        let passengerForDriver = undefined;
        try {
          if (bfull && bfull.passengerId) {
            const p = await Passenger.findById(String(bfull.passengerId)).select({ _id: 1, name: 1, phone: 1 }).lean();
            if (p) passengerForDriver = { id: String(p._id), name: p.name, phone: p.phone };
          }
        } catch (_) {}
        const tokenCarName = socket.user && (socket.user.carName || socket.user.carModel || socket.user.vehicleName || socket.user.carname);
        const tokenCarPlate = socket.user && (socket.user.carPlate || socket.user.car_plate || socket.user.carPlateNumber || socket.user.plate || socket.user.plateNumber);
        const tokenCarColor = socket.user && (socket.user.carColor || socket.user.color);
        const dbCarName = d && (d.carModel || d.carName);
        const dbCarPlate = d && d.carPlate;
        const dbCarColor = d && d.carColor;
        const carNameOut = (dbCarName || tokenCarName) || null;
        const carPlateOut = (dbCarPlate || tokenCarPlate) || null;
        const carColorOut = undefined; // removed per requirement
        const driverPayload = {
          id: String(socket.user.id),
          name: (d && d.name) || socket.user.name,
          phone: (d && d.phone) || socket.user.phone,
          email: (d && d.email) || socket.user.email,
          vehicleType: (d && d.vehicleType) || socket.user.vehicleType,
          carName: carNameOut,
          carPlate: carPlateOut,
          rating: (d && (d.rating || d.rating === 0 ? d.rating : undefined)) ?? 5.0
        };
        const bookingDetails = bfull ? {
          id: String(bfull._id),
          status: bfull.status,
          passengerId: bfull.passengerId ? String(bfull.passengerId) : undefined,
          passenger: passengerForDriver || (bfull.passengerId ? { id: String(bfull.passengerId), name: bfull.passengerName, phone: bfull.passengerPhone } : undefined),
          vehicleType: bfull.vehicleType,
          pickup: bfull.pickup,
          dropoff: bfull.dropoff,
          fareEstimated: bfull.fareEstimated,
          fareFinal: bfull.fareFinal,
          distanceKm: bfull.distanceKm,
          createdAt: bfull.createdAt,
          updatedAt: bfull.updatedAt
        } : undefined;
        const acceptPayload = {
          id: String(updated._id),
          bookingId: String(updated._id),
          status: 'accepted',
          driverId: String(socket.user.id),
          driver: driverPayload,
          booking: bookingDetails,
          user: { id: String(socket.user.id), type: 'driver' }
        };
        try { logger.info('[socket->room] booking_accept', { room, bookingId: acceptPayload.bookingId, driverId: driverPayload.id }); } catch (_) {}
        io.to(room).emit('booking_accept', acceptPayload);
        // Also emit alias booking:accept for clients expecting this topic name
        io.to(room).emit('booking:accept', acceptPayload);

        // Additionally notify passenger room directly to avoid missing room join timing
        try { if (updated.passengerId) io.to(`passenger:${String(updated.passengerId)}`).emit('booking_accept', acceptPayload); } catch (_) {}
        try { if (updated.passengerId) io.to(`passenger:${String(updated.passengerId)}`).emit('booking:accept', acceptPayload); } catch (_) {}

        // Emit immediate booking:status snapshot to room and passenger room for clients relying on status stream
        try {
          const statusSnapshot = {
            id: String(updated._id),
            bookingId: String(updated._id),
            status: 'accepted',
            driverId: String(socket.user.id),
            passengerId: String(updated.passengerId || ''),
            vehicleType: updated.vehicleType,
            pickup: updated.pickup,
            dropoff: updated.dropoff,
            acceptedAt: updated.acceptedAt
          };
          io.to(room).emit('booking:status', statusSnapshot);
          try { if (updated.passengerId) io.to(`passenger:${String(updated.passengerId)}`).emit('booking:status', statusSnapshot); } catch (_) {}
        } catch (_) {}
      } catch (_) {}

      // Inform nearby drivers to remove
      try {
        const { Driver } = require('../models/userModels');
        const geolib = require('geolib');
        const drivers = await Driver.find({ available: true }).lean();
        const radiusKm = parseFloat(process.env.RADIUS_KM || process.env.BROADCAST_RADIUS_KM || '5');
        const vehicleType = updated.vehicleType;
        const nearby = drivers.filter(d => (
          d && d._id && String(d._id) !== String(socket.user.id) &&
          d.lastKnownLocation &&
          (!vehicleType || String(d.vehicleType || '').toLowerCase() === String(vehicleType || '').toLowerCase()) &&
          (geolib.getDistance(
            { latitude: d.lastKnownLocation.latitude, longitude: d.lastKnownLocation.longitude },
            { latitude: updated.pickup?.latitude, longitude: updated.pickup?.longitude }
          ) / 1000) <= radiusKm
        ));
        nearby.forEach(d => sendMessageToSocketId(`driver:${String(d._id)}`, { event: 'booking:removed', data: { bookingId: String(updated._id) } }));
        try { logger.info('[socket->drivers] booking:removed broadcast', { bookingId: String(updated._id), count: nearby.length }); } catch (_) {}
      } catch (_) {}
    } catch (err) {
      try {
        const safe = (m) => (m && m.message) ? m.message : 'Failed to accept booking';
        socket.emit('booking_error', { message: safe(err), source: 'booking_accept' });
      } catch (_) {}
    }
  });

  // booking_cancel
  socket.on('booking_cancel', async (payload) => {
    try { logger.info('[socket<-user] booking_cancel', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const bookingId = String(data.bookingId || '');
      const reason = data.reason;
      if (!socket.user || !socket.user.type) return socket.emit('booking_error', { message: 'Unauthorized: user token required', bookingId });
      if (!bookingId) return socket.emit('booking_error', { message: 'bookingId is required', bookingId });
      const updated = await bookingService.updateBookingLifecycle({ requester: socket.user, id: bookingId, status: 'canceled' });
      bookingEvents.emitBookingUpdate(String(updated._id), { status: 'canceled', canceledBy: String(socket.user.type).toLowerCase(), canceledReason: reason });
      try { logger.info('[socket->room] booking:update canceled', { bookingId: String(updated._id), by: String(socket.user.type).toLowerCase() }); } catch (_) {}
    } catch (err) {}
  });

  // trip_started
  socket.on('trip_started', async (payload) => {
    try { logger.info('[socket<-driver] trip_started', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const bookingId = String(data.bookingId || '');
      const startLocation = data.startLocation || data.location;
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver') {
        return socket.emit('booking_error', { message: 'Unauthorized: driver token required', source: 'trip_started' });
      }
      if (!bookingId) return socket.emit('booking_error', { message: 'bookingId is required', source: 'trip_started' });
      const booking = await Booking.findOne({ _id: bookingId, driverId: String(socket.user.id) });
      if (!booking) return socket.emit('booking_error', { message: 'Booking not found or not assigned to you', source: 'trip_started' });
      const updated = await lifecycle.startTrip(bookingId, startLocation);
      bookingEvents.emitTripStarted(io, updated);
      // Also emit an initial trip_ongoing update at the start location for clients expecting continuous stream from start
      try { if (startLocation) bookingEvents.emitTripOngoing(io, updated, startLocation); } catch (_) {}
      try { logger.info('[socket->room] trip_started', { bookingId: String(updated._id) }); } catch (_) {}
    } catch (err) {
      logger.error('[trip_started] error', err);
      socket.emit('booking_error', { message: 'Failed to start trip', source: 'trip_started' });
    }
  });

  // trip_ongoing
  socket.on('trip_ongoing', async (payload) => {
    try { logger.info('[socket<-driver] trip_ongoing', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const bookingId = String(data.bookingId || '');
      const location = data.location || { latitude: data.latitude, longitude: data.longitude };
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver') {
        return socket.emit('booking_error', { message: 'Unauthorized: driver token required', source: 'trip_ongoing' });
      }
      if (!bookingId || !location || location.latitude == null || location.longitude == null) {
        return socket.emit('booking_error', { message: 'bookingId and location are required', source: 'trip_ongoing' });
      }
      const booking = await Booking.findOne({ _id: bookingId, driverId: String(socket.user.id) }).lean();
      if (!booking) return socket.emit('booking_error', { message: 'Booking not found or not assigned to you', source: 'trip_ongoing' });
      const point = await lifecycle.updateTripLocation(bookingId, String(socket.user.id), location);
      bookingEvents.emitTripOngoing(io, bookingId, point);
      try { logger.info('[socket->room] trip_ongoing', { bookingId, lat: point.lat, lon: point.lng }); } catch (_) {}

      // Live pricing recompute based on current path length from TripHistory
      try {
        const TripHistory = require('../models/tripHistoryModel');
        const { calculateFare } = require('../services/pricingService');
        const { haversineKm } = require('../utils/distance');
        const trip = await TripHistory.findOne({ bookingId });
        let distanceKm = 0;
        if (trip && Array.isArray(trip.locations) && trip.locations.length >= 2) {
          for (let i = 1; i < trip.locations.length; i++) {
            const a = trip.locations[i - 1];
            const b = trip.locations[i];
            distanceKm += haversineKm({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng });
          }
        } else if (booking.pickup && location) {
          distanceKm = haversineKm({ latitude: booking.pickup.latitude, longitude: booking.pickup.longitude }, { latitude: location.latitude, longitude: location.longitude });
        }
        const elapsedMinutes = 0; // optional: compute from startedAt if needed
        const estFare = await calculateFare(distanceKm, elapsedMinutes, booking.vehicleType, 1, 0);
        const payloadUpdate = {
          bookingId: String(booking._id),
          vehicleType: booking.vehicleType,
          pickup: booking.pickup,
          dropoff: booking.dropoff,
          distanceKm,
          fareEstimated: estFare,
          fareBreakdown: {
            base: undefined,
            distanceCost: undefined,
            timeCost: undefined,
            waitingCost: undefined,
            surgeMultiplier: 1
          }
        };
        io.to(`booking:${String(booking._id)}`).emit('pricing:update', payloadUpdate);
      } catch (e) { try { logger.error('[trip_ongoing] live pricing failed', e); } catch (_) {} }
    } catch (err) {
      logger.error('[trip_ongoing] error', err);
      socket.emit('booking_error', { message: 'Failed to update trip location', source: 'trip_ongoing' });
    }
  });

  // trip_completed
  socket.on('trip_completed', async (payload) => {
    try { logger.info('[socket<-driver] trip_completed', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const bookingId = String(data.bookingId || '');
      const endLocation = data.endLocation || data.location;
      const surgeMultiplier = data.surgeMultiplier || 1;
      const discount = data.discount || 0;
      const debitPassengerWallet = !!data.debitPassengerWallet;
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver') {
        return socket.emit('booking_error', { message: 'Unauthorized: driver token required', source: 'trip_completed' });
      }
      if (!bookingId) return socket.emit('booking_error', { message: 'bookingId is required', source: 'trip_completed' });
      const booking = await Booking.findOne({ _id: bookingId, driverId: String(socket.user.id) });
      if (!booking) return socket.emit('booking_error', { message: 'Booking not found or not assigned to you', source: 'trip_completed' });
      const updated = await lifecycle.completeTrip(bookingId, endLocation, { surgeMultiplier, discount, debitPassengerWallet });
      bookingEvents.emitTripCompleted(io, updated);
      try { logger.info('[socket->room] trip_completed', { bookingId: String(updated._id) }); } catch (_) {}
    } catch (err) {
      logger.error('[trip_completed] error', err);
      socket.emit('booking_error', { message: 'Failed to complete trip', source: 'trip_completed' });
    }
  });
};
