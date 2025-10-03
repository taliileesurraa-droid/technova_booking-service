const driverService = require('../services/driverService');
const driverEvents = require('../events/driverEvents');
const { calculateLivePricing } = require('../services/bookingPricingService');
const logger = require('../utils/logger');
const { markDispatched, wasDispatched, registerSocket, unregisterSocket, setSocketAvailability, setLiveLocation } = require('./dispatchRegistry');

module.exports = (io, socket) => {
  // On connection, send initial nearby unassigned bookings (pre-existing) and current driver bookings
  try {
    if (socket.user && String(socket.user.type).toLowerCase() === 'driver') {
      // Join driver-specific room so targeted events like booking:new and booking:removed are received
      try {
        (async () => {
          const tokenDriverId = String(socket.user.id);
          const { Driver } = require('../models/userModels');
          const { Types } = require('mongoose');
          let meForRoom = null;
          try {
            if (Types.ObjectId.isValid(tokenDriverId)) {
              meForRoom = await Driver.findById(tokenDriverId).select({ _id: 1, available: 1, lastKnownLocation: 1, vehicleType: 1 }).lean();
            }
            if (!meForRoom && socket.user.email) {
              meForRoom = await Driver.findOne({ email: socket.user.email }).select({ _id: 1, available: 1, lastKnownLocation: 1, vehicleType: 1 }).lean();
            }
            if (!meForRoom && socket.user.phone) {
              meForRoom = await Driver.findOne({ phone: socket.user.phone }).select({ _id: 1, available: 1, lastKnownLocation: 1, vehicleType: 1 }).lean();
            }
          } catch (_) {}

          const driverDbId = String(meForRoom?._id || tokenDriverId);

          // Join both token-based and DB-based ids to handle environments where token id != DB _id
          try { socket.join(`driver:${tokenDriverId}`); } catch (_) {}
          try { socket.join(`driver:${driverDbId}`); } catch (_) {}
          // Also join a shared drivers room for optional broadcasts/fallbacks
          try { socket.join('drivers'); } catch (_) {}

          // Register socket mapping for availability tracking
          try { registerSocket(driverDbId, socket.id); } catch (_) {}
        })();
      } catch (_) {}
      (async () => {
        try {
          const { Booking } = require('../models/bookingModels');
          const { Driver } = require('../models/userModels');
          const { Wallet } = require('../models/common');
          const financeService = require('../services/financeService');
          const geolib = require('geolib');

          const tokenDriverId = String(socket.user.id);
          const { Types } = require('mongoose');
          let me = null;
          if (Types.ObjectId.isValid(tokenDriverId)) {
            me = await Driver.findById(tokenDriverId).lean();
          }
          if (!me && socket.user.email) me = await Driver.findOne({ email: socket.user.email }).lean();
          if (!me && socket.user.phone) me = await Driver.findOne({ phone: socket.user.phone }).lean();
          const driverId = String(me?._id || tokenDriverId);
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
    const filtered = withDistance
      .filter(x => financeService.canAcceptBooking(balance, x.booking.fareFinal || x.booking.fareEstimated || 0))
      .slice(0, 50);

    // Bulk fetch passenger details for enrichment
    let passengerMap = {};
    try {
      const { Passenger } = require('../models/userModels');
      const ids = [...new Set(filtered.map(x => x.booking.passengerId).filter(Boolean))];
      const docs = ids.length ? await Passenger.find({ _id: { $in: ids } }).select({ _id: 1, name: 1, phone: 1, email: 1, emergencyContacts: 1 }).lean() : [];
      passengerMap = Object.fromEntries(docs.map(p => [String(p._id), { id: String(p._id), name: p.name, phone: p.phone, email: p.email, emergencyContacts: p.emergencyContacts }]));
    } catch (_) {}

    nearby = filtered.map(x => ({
      id: String(x.booking._id),
      status: x.booking.status,
      pickup: x.booking.pickup,
      dropoff: x.booking.dropoff,
      fareEstimated: x.booking.fareEstimated,
      fareFinal: x.booking.fareFinal,
      distanceKm: Math.round(x.distanceKm * 100) / 100,
      // Keep passenger format as original: { id, name, phone }
      passenger: x.booking.passengerId ? (passengerMap[String(x.booking.passengerId)] || { id: String(x.booking.passengerId), name: x.booking.passengerName, phone: x.booking.passengerPhone }) : undefined,
      createdAt: x.booking.createdAt,
      updatedAt: x.booking.updatedAt
    }));

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
      const tokenDriverId = String(socket.user.id);
      const { Driver } = require('../models/userModels');
      const { Types } = require('mongoose');
      let meResolved = null;
      try {
        if (Types.ObjectId.isValid(tokenDriverId)) meResolved = await Driver.findById(tokenDriverId).select({ _id: 1 }).lean();
        if (!meResolved && socket.user.email) meResolved = await Driver.findOne({ email: socket.user.email }).select({ _id: 1 }).lean();
        if (!meResolved && socket.user.phone) meResolved = await Driver.findOne({ phone: socket.user.phone }).select({ _id: 1 }).lean();
      } catch (_) {}
      const driverDbId = String(meResolved?._id || tokenDriverId);
      const updated = await driverService.setAvailability(driverDbId, available, socket.user);
      // Update runtime availability per socket under both ids (token and DB)
      try { setSocketAvailability(driverDbId, socket.id, !!available); } catch (_) {}
      try { if (driverDbId !== tokenDriverId) setSocketAvailability(tokenDriverId, socket.id, !!available); } catch (_) {}
      driverEvents.emitDriverAvailability(driverDbId, !!available);
      try { logger.info('[socket->driver] availability updated', { userId: driverDbId, available }); } catch (_) {}

      // If driver just became available, proactively push nearby open bookings
      if (available === true) {
        try {
          const { Booking } = require('../models/bookingModels');
          const { Driver } = require('../models/userModels');
          const { Wallet } = require('../models/common');
          const financeService = require('../services/financeService');
          const geolib = require('geolib');

          const tokenDriverId = String(socket.user.id);
          const { Types } = require('mongoose');
          let me = null;
          if (Types.ObjectId.isValid(tokenDriverId)) me = await Driver.findById(tokenDriverId).lean();
          if (!me && socket.user.email) me = await Driver.findOne({ email: socket.user.email }).lean();
          if (!me && socket.user.phone) me = await Driver.findOne({ phone: socket.user.phone }).lean();
          const driverId = String(me?._id || tokenDriverId);
          const radiusKm = parseFloat(process.env.BROADCAST_RADIUS_KM || process.env.RADIUS_KM || '5');

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

            const w = await Wallet.findOne({ userId: driverId, role: 'driver' }).lean();
            const balance = w ? Number(w.balance || 0) : 0;
            const nearby = withDistance
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

            // Emit incremental nearby snapshot
            const payloadNearby = {
              init: false,
              driverId,
              bookings: nearby,
              currentBookings: [],
              user: { id: driverId, type: 'driver' }
            };
            try { logger.info('[socket->driver] emit booking:nearby (availability=true)', { sid: socket.id, userId: driverId, nearbyCount: payloadNearby.bookings.length }); } catch (_) {}
            socket.emit('booking:nearby', payloadNearby);

            // Also emit booking:new per item for clients relying on this channel
            const channel = `driver:${driverId}`;
            for (const n of nearby) {
              try {
                const patch = {
                  status: n.status,
                  passengerId: n.passenger?.id,
                  vehicleType: undefined,
                  pickup: n.pickup,
                  dropoff: n.dropoff,
                  passenger: n.passenger
                };
                const payloadForDriver = { id: n.id, bookingId: n.id, booking: { ...n }, patch, user: { id: n.passenger?.id, type: 'passenger' }, recipient: { id: driverId, type: 'driver' } };
                io.to(channel).emit('booking:new', payloadForDriver);
              } catch (_) {}
            }
          }
        } catch (_) {}
      }
    } catch (err) {
      socket.emit('booking_error', { message: 'Failed to update availability', source: 'driver:availability' });
    }
  });

  socket.on('disconnect', () => {
    try {
      if (socket.user && socket.user.id) {
        unregisterSocket(String(socket.user.id), socket.id);
      }
    } catch (_) {}
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
      const tokenDriverId = String(socket.user.id);
      const { Driver } = require('../models/userModels');
      const { Types } = require('mongoose');
      let meResolved = null;
      try {
        if (Types.ObjectId.isValid(tokenDriverId)) meResolved = await Driver.findById(tokenDriverId).select({ _id: 1 }).lean();
        if (!meResolved && socket.user.email) meResolved = await Driver.findOne({ email: socket.user.email }).select({ _id: 1 }).lean();
        if (!meResolved && socket.user.phone) meResolved = await Driver.findOne({ phone: socket.user.phone }).select({ _id: 1 }).lean();
      } catch (_) {}
      const driverDbId = String(meResolved?._id || tokenDriverId);
      const d = await driverService.updateLocation(driverDbId, data, socket.user);
      // Update live location cache for immediate targeting decisions under both ids
      try { setLiveLocation(driverDbId, data); } catch (_) {}
      try { if (driverDbId !== tokenDriverId) setLiveLocation(tokenDriverId, data); } catch (_) {}
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

  // Handle pricing update requests from driver
  socket.on('pricing:update', async (payload) => {
    const startTime = Date.now();
    try {
      logger.info('[Socket] Received pricing:update request:', { 
        socketId: socket.id, 
        driverId: socket.user && socket.user.id,
        payload,
        timestamp: new Date().toISOString()
      });
      
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver') {
        logger.warn('[Socket] Unauthorized pricing:update request:', {
          socketId: socket.id,
          userType: socket.user?.type || 'none',
          userId: socket.user?.id || 'none'
        });
        return socket.emit('pricing:error', { 
          message: 'Unauthorized: driver token required', 
          source: 'pricing:update' 
        });
      }

      const raw = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const { bookingId, location } = raw;
      
      logger.info('[Socket] Parsed pricing:update payload:', {
        socketId: socket.id,
        driverId: socket.user.id,
        bookingId,
        location,
        hasValidLocation: !!(location && location.latitude && location.longitude)
      });
      
      if (!bookingId || !location || !location.latitude || !location.longitude) {
        logger.error('[Socket] Invalid pricing:update payload:', {
          socketId: socket.id,
          driverId: socket.user.id,
          bookingId: bookingId || 'missing',
          location: location || 'missing',
          missingFields: {
            bookingId: !bookingId,
            location: !location,
            latitude: !location?.latitude,
            longitude: !location?.longitude
          }
        });
        return socket.emit('pricing:error', { 
          message: 'bookingId and location (with latitude/longitude) are required',
          source: 'pricing:update'
        });
      }

      // Verify this driver is assigned to the booking
      const driverId = String(socket.user.id);
      
      logger.info('[Socket] Verifying booking assignment:', {
        socketId: socket.id,
        driverId,
        bookingId
      });

      const { Booking } = require('../models/bookingModels');
      const booking = await Booking.findById(bookingId);
      
      if (!booking) {
        logger.error('[Socket] Booking not found for pricing update:', {
          socketId: socket.id,
          driverId,
          bookingId
        });
        return socket.emit('pricing:error', { 
          message: 'Booking not found',
          source: 'pricing:update'
        });
      }

      logger.info('[Socket] Booking found, verifying assignment:', {
        socketId: socket.id,
        bookingId,
        requestingDriverId: driverId,
        assignedDriverId: booking.driverId,
        bookingStatus: booking.status,
        isAssigned: String(booking.driverId) === driverId
      });

      if (String(booking.driverId) !== driverId) {
        logger.warn('[Socket] Driver not assigned to booking:', {
          socketId: socket.id,
          bookingId,
          requestingDriverId: driverId,
          assignedDriverId: booking.driverId
        });
        return socket.emit('pricing:error', { 
          message: 'You are not assigned to this booking',
          source: 'pricing:update'
        });
      }

      // Calculate live pricing based on current location
      logger.info('[Socket] Calling pricing service:', {
        socketId: socket.id,
        driverId,
        bookingId,
        location
      });

      const pricingResult = await calculateLivePricing(bookingId, location);
      
      logger.info('[Socket] Pricing calculation successful, sending to driver:', {
        socketId: socket.id,
        driverId,
        bookingId,
        pricingResult: {
          currentFare: pricingResult.currentFare,
          distanceTraveled: pricingResult.distanceTraveled,
          updatedAt: pricingResult.updatedAt
        }
      });
      
      // Send pricing update back to the driver
      socket.emit('pricing:update', pricingResult);
      
      const processingTime = Date.now() - startTime;
      logger.info('[Socket] Pricing update completed successfully:', { 
        socketId: socket.id,
        driverId, 
        bookingId, 
        currentFare: pricingResult.currentFare,
        distanceTraveled: pricingResult.distanceTraveled,
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error('[Socket] Error in pricing update flow:', {
        socketId: socket.id,
        driverId: socket.user?.id,
        bookingId: payload?.bookingId || 'unknown',
        error: error.message,
        stack: error.stack,
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString()
      });
      
      socket.emit('pricing:error', { 
        message: 'Failed to calculate pricing update',
        error: error.message,
        source: 'pricing:update'
      });
    }
  });
};

