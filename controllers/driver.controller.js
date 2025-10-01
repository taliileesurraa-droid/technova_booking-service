const { Driver } = require('../models/userModels');
const { crudController } = require('./basic.crud');
const driverService = require('../services/driverService');
const driverEvents = require('../events/driverEvents');
const errorHandler = require('../utils/errorHandler');
const paymentService = require('../services/paymentService');

const base = {
  ...crudController(Driver),
  list: async (req, res) => {
    try {
      const { page = 1, limit = 20, status, available } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      let query = {};
      if (status) {
        query.status = status;
      }
      if (available !== undefined) {
        query.available = available === 'true';
      }
      
      const drivers = await Driver.find(query)
        .select('_id name phone email vehicleType available lastKnownLocation rating createdAt updatedAt')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 })
        .lean();
      
      const total = await Driver.countDocuments(query);
      
      const response = drivers.map(d => ({
        id: String(d._id),
        name: d.name,
        phone: d.phone,
        email: d.email,
        vehicleType: d.vehicleType,
        available: !!d.available,
        lastKnownLocation: d.lastKnownLocation || null,
        rating: d.rating || 5.0,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt
      }));
      
      return res.json({
        drivers: response,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (e) {
      return res.status(500).json({ message: `Failed to retrieve Driver list: ${e.message}` });
    }
  },
  get: async (req, res) => {
    try {
      const driver = await Driver.findById(req.params.id)
        .select('_id name phone email vehicleType available lastKnownLocation rating externalId createdAt updatedAt paymentPreference')
        .populate({ path: 'paymentPreference', select: { name: 1, logo: 1 } })
        .lean();
      
      if (!driver) {
        return res.status(404).json({ message: 'Driver not found' });
      }
      // Enrich from external service when needed using externalId
      let name = driver.name;
      let phone = driver.phone;
      let email = driver.email;
      const lookupExternalId = driver.externalId ? String(driver.externalId) : null;
      if ((!name || !phone) && lookupExternalId) {
        try {
          const { getDriverById } = require('../integrations/userServiceClient');
          const ext = await getDriverById(lookupExternalId, { headers: req.headers.authorization ? { Authorization: req.headers.authorization } : undefined });
          if (ext) {
            name = name || ext.name;
            phone = phone || ext.phone;
            email = email || ext.email;
          }
        } catch (_) {}
      }

      const response = {
        id: String(driver._id),
        name: name,
        phone: phone,
        email: email,
        vehicleType: driver.vehicleType,
        available: !!driver.available,
        lastKnownLocation: driver.lastKnownLocation || null,
        rating: driver.rating || 5.0,
        paymentPreference: driver.paymentPreference ? {
          _id: String(driver.paymentPreference._id),
          name: driver.paymentPreference.name,
          logo: driver.paymentPreference.logo
        } : null,
        createdAt: driver.createdAt,
        updatedAt: driver.updatedAt
      };
      
      return res.json(response);
    } catch (e) {
      return res.status(500).json({ message: `Failed to retrieve Driver: ${e.message}` });
    }
  }
};

async function setAvailability(req, res) {
  try {
    const driverId = String((((req.user && req.user.id) !== undefined && (req.user && req.user.id) !== null) ? req.user.id : req.params.id) || '');
    if (!driverId) return res.status(400).json({ message: 'Invalid driver id' });
    const d = await driverService.setAvailability(driverId, !!req.body.available, req.user || {});
    const response = {
      id: String(d._id),
      driverId: String(d._id),
      available: d.available,
      vehicleType: d.vehicleType,
      lastKnownLocation: d.lastKnownLocation,
      rating: d.rating || 5.0,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      driver: {
        id: String(req.user.id),
        name: req.user.name || req.user.fullName || req.user.displayName,
        phone: req.user.phone || req.user.phoneNumber || req.user.mobile,
        email: req.user.email,
        vehicleType: req.user.vehicleType
      }
    };
    driverEvents.emitDriverAvailability(String(d._id), !!d.available);
    return res.json(response);
  } catch (e) { errorHandler(res, e); }
}

async function updateLocation(req, res) {
  try {
    const driverId = String((((req.user && req.user.id) !== undefined && (req.user && req.user.id) !== null) ? req.user.id : req.params.id) || '');
    if (!driverId) return res.status(400).json({ message: 'Invalid driver id' });
    const d = await driverService.updateLocation(driverId, req.body, req.user || {});
    const response = {
      id: String(d._id),
      driverId: String(d._id),
      available: d.available,
      vehicleType: d.vehicleType,
      lastKnownLocation: d.lastKnownLocation,
      rating: d.rating || 5.0,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      driver: {
        id: String(req.user.id),
        name: req.user.name || req.user.fullName || req.user.displayName,
        phone: req.user.phone || req.user.phoneNumber || req.user.mobile,
        email: req.user.email,
        vehicleType: req.user.vehicleType
      }
    };
    driverEvents.emitDriverLocationUpdate({
      driverId: String(d._id),
      vehicleType: d.vehicleType,
      available: d.available,
      lastKnownLocation: d.lastKnownLocation,
      updatedAt: d.updatedAt
    });
    return res.json(response);
  } catch (e) { errorHandler(res, e); }
}

async function availableNearby(req, res) {
  try {
    const { latitude, longitude, radiusKm = 5, vehicleType } = req.query;
    const enriched = await driverService.availableNearby({ latitude, longitude, radiusKm, vehicleType });
    return res.json(enriched);
  } catch (e) { errorHandler(res, e); }
}

function distanceKm(a, b) {
  if (!a || !b || a.latitude == null || b.latitude == null) return Number.POSITIVE_INFINITY;
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const aHarv = Math.sin(dLat/2)**2 + Math.sin(dLon/2)**2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(aHarv));
}

// Fare estimation for passengers before booking
async function estimateFareForPassenger(req, res) {
  try {
    const { vehicleType = 'mini', pickup, dropoff } = req.body;
    const result = await driverService.estimateFareForPassenger({ vehicleType, pickup, dropoff });
    res.json(result);
  } catch (e) { errorHandler(res, e); }
}

// Fare estimation for drivers before accepting booking
async function estimateFareForDriver(req, res) {
  try {
    const { bookingId } = req.params;
    const { Booking } = require('../models/bookingModels');
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (booking.driverId && booking.driverId !== req.user.id) return res.status(403).json({ message: 'You are not assigned to this booking' });
    const result = await driverService.estimateFareForDriver(booking);
    res.json({ bookingId: booking._id, vehicleType: booking.vehicleType, ...result, pickup: booking.pickup, dropoff: booking.dropoff });
  } catch (e) { errorHandler(res, e); }
}

module.exports = { 
  ...base, 
  setAvailability, 
  updateLocation, 
  availableNearby, 
  estimateFareForPassenger, 
  estimateFareForDriver,
  // Payment options
  listPaymentOptions: async (req, res) => {
    try {
      const rows = await paymentService.getPaymentOptions();
      let selectedId = null;
      try {
        if (req.user && req.user.type === 'driver') {
          const me = await Driver.findById(String(req.user.id)).select({ paymentPreference: 1 }).lean();
          selectedId = me && me.paymentPreference ? String(me.paymentPreference) : null;
        }
      } catch (_) {}
      const data = (rows || []).map(o => ({ id: String(o._id || o.id), name: o.name, logo: o.logo, selected: selectedId ? String(o._id || o.id) === String(selectedId) : false }));
      return res.json(data);
    } catch (e) { errorHandler(res, e); }
  },
  setPaymentPreference: async (req, res) => {
    try {
      let { paymentOptionId, driverId, id } = req.body || {};
      // Accept `id` as an alias for `paymentOptionId` for convenience
      if (!paymentOptionId && id) paymentOptionId = id;
      const actingIsDriver = req.user && req.user.type === 'driver';
      const actingIsAdmin = req.user && (req.user.type === 'admin' || (Array.isArray(req.user.roles) && req.user.roles.includes('superadmin')));
      const targetDriverId = actingIsDriver ? String(req.user.id) : String(driverId || '');
      if (!actingIsDriver && !actingIsAdmin) return res.status(403).json({ message: 'Forbidden: driver or admin required' });
      if (!paymentOptionId) return res.status(400).json({ message: 'paymentOptionId is required' });
      if (!targetDriverId) return res.status(400).json({ message: 'driverId is required for admin to set preference' });
      const updated = await paymentService.setDriverPaymentPreference(targetDriverId, paymentOptionId);
      return res.json(updated);
    } catch (e) { errorHandler(res, e); }
  }
};

// Combined driver discovery and fare estimation for passengers
async function discoverAndEstimate(req, res) {
  try {
    const { pickup, dropoff, radiusKm = 5, vehicleType } = req.body || {};

    if (!pickup || !dropoff) {
      return res.status(400).json({ message: 'pickup and dropoff are required' });
    }
    if (
      pickup.latitude == null || pickup.longitude == null ||
      dropoff.latitude == null || dropoff.longitude == null
    ) {
      return res.status(400).json({ message: 'Valid latitude and longitude are required for pickup and dropoff' });
    }

    // Find nearby available drivers (reuse logic with minimal duplication)
    const all = await Driver.find({ available: true, ...(vehicleType ? { vehicleType } : {}) });

    // Robust pickup coordinate handling similar to availableNearby
    const latNum = Number(pickup.latitude);
    const lonNum = Number(pickup.longitude);
    const rKm = Number(radiusKm);
    const lons = all.map(d => (d.lastKnownLocation && Number.isFinite(d.lastKnownLocation.longitude) ? d.lastKnownLocation.longitude : null)).filter(v => v != null);
    const negCount = lons.filter(v => v < 0).length;
    const posCount = lons.length - negCount;
    const expectedLonSign = negCount >= posCount ? -1 : 1;
    const candidates = [
      { lat: latNum, lon: lonNum },
      { lat: lonNum, lon: latNum },
      { lat: latNum, lon: expectedLonSign * Math.abs(lonNum) },
      { lat: lonNum, lon: expectedLonSign * Math.abs(latNum) }
    ];
    function countWithin(target) {
      const distances = all
        .filter(d => d.lastKnownLocation)
        .map(d => distanceKm(d.lastKnownLocation, { latitude: target.lat, longitude: target.lon }));
      const inRange = distances.filter(d => d <= rKm);
      const avg = inRange.length ? (inRange.reduce((a, b) => a + b, 0) / inRange.length) : Number.POSITIVE_INFINITY;
      return { count: inRange.length, avg };
    }
    let chosen = candidates[0];
    let bestScore = { count: -1, avg: Number.POSITIVE_INFINITY };
    for (const c of candidates) {
      const score = countWithin(c);
      if (score.count > bestScore.count || (score.count === bestScore.count && score.avg < bestScore.avg)) {
        bestScore = score;
        chosen = c;
      }
    }
    const nearby = all.filter(d => d.lastKnownLocation && distanceKm(d.lastKnownLocation, { latitude: chosen.lat, longitude: chosen.lon }) <= rKm);

    // Enrich driver data via templated external user directory to target the correct API
    const { getDriverById: getDriverById2, listDrivers: listDrivers2, getDriversByIds: getDriversByIds2 } = require('../integrations/userServiceClient');
    const authHeader2 = req.headers && req.headers.authorization ? { Authorization: req.headers.authorization } : undefined;

    // Try batch first for efficiency using externalId when present
    let idToExternal = {};
    const extIds2 = nearby.map(d => d.externalId).filter(Boolean).map(String);
    if (extIds2.length) {
      try {
        const batch = await getDriversByIds2(extIds2, authHeader2?.Authorization);
        idToExternal = Object.fromEntries((batch || []).map(u => [String(u.id), { name: u.name, phone: u.phone, email: u.email }]));
      } catch (_) {}
    }

    const drivers = await Promise.all(nearby.map(async (driver) => {
      const base = {
        id: String(driver._id),
        driverId: String(driver._id),
        vehicleType: driver.vehicleType,
        rating: driver.rating || 5.0,
        lastKnownLocation: driver.lastKnownLocation || null,
        distanceKm: distanceKm(driver.lastKnownLocation, { latitude: chosen.lat, longitude: chosen.lon })
      };

      let lookupExternalId2 = driver.externalId ? String(driver.externalId) : null;
      let name = (lookupExternalId2 && idToExternal[lookupExternalId2]?.name) || driver.name || undefined;
      let phone = (lookupExternalId2 && idToExternal[lookupExternalId2]?.phone) || driver.phone || undefined;
      let email = (lookupExternalId2 && idToExternal[lookupExternalId2]?.email) || driver.email || undefined;
      if (!name || !phone) {
        try {
          const ext = lookupExternalId2 ? await getDriverById2(lookupExternalId2, { headers: authHeader2 }) : null;
          if (ext) {
            name = name || ext.name;
            phone = phone || ext.phone;
            email = email || ext.email;
            // persist enrichment
            try {
              const update = { };
              if (ext.name && !driver.name) update.name = ext.name;
              if (ext.phone && !driver.phone) update.phone = ext.phone;
              if (driver.externalId == null && lookupExternalId2) update.externalId = String(lookupExternalId2);
              if (Object.keys(update).length) await Driver.findByIdAndUpdate(driver._id, { $set: update });
            } catch (_) {}
          }
          if ((!name || !phone) && lookupExternalId2) {
            const list = await listDrivers2({ vehicleType: driver.vehicleType }, { headers: authHeader2 });
            const match = (list || []).find(u => String(u.id) === lookupExternalId2);
            if (match) {
              name = name || match.name;
              phone = phone || match.phone;
              email = email || match.email;
              // persist
              try {
                const update = { };
                if (match.name && !driver.name) update.name = match.name;
                if (match.phone && !driver.phone) update.phone = match.phone;
                if (Object.keys(update).length) await Driver.findByIdAndUpdate(driver._id, { $set: update });
              } catch (_) {}
            }
          }
          // If no externalId, try lookup by internal id and persist returned id as externalId
          if ((!name || !phone) && !lookupExternalId2) {
            const maybe = await getDriverById2(String(driver._id), { headers: authHeader2 });
            if (maybe) {
              name = name || maybe.name;
              phone = phone || maybe.phone;
              email = email || maybe.email;
              if (maybe.id && String(maybe.id) !== String(driver._id)) {
                try { await Driver.findByIdAndUpdate(driver._id, { $set: { externalId: String(maybe.id) } }); } catch (_) {}
                lookupExternalId2 = String(maybe.id);
              }
            }
          }
        } catch (_) {}
      }

      const driverInfo = {
        id: String(driver._id),
        name: name || '',
        phone: phone || '',
        email: email || '',
        vehicleType: driver.vehicleType
      };

      return { ...base, driver: driverInfo };
    }));
    drivers.sort((a, b) => a.distanceKm - b.distanceKm);

    // Fare estimation
    const pricing = await Pricing.findOne({ vehicleType: vehicleType || 'mini', isActive: true }).sort({ updatedAt: -1 });
    if (!pricing) {
      return res.status(404).json({ message: `No pricing found for vehicle type: ${vehicleType || 'mini'}` });
    }

    const distanceKmVal = geolib.getDistance(
      { latitude: pickup.latitude, longitude: pickup.longitude },
      { latitude: dropoff.latitude, longitude: dropoff.longitude }
    ) / 1000;

    const fareBreakdown = {
      base: pricing.baseFare,
      distanceCost: distanceKmVal * pricing.perKm,
      timeCost: 0,
      waitingCost: 0,
      surgeMultiplier: pricing.surgeMultiplier
    };
    const estimatedFare = (fareBreakdown.base + fareBreakdown.distanceCost + fareBreakdown.timeCost + fareBreakdown.waitingCost) * fareBreakdown.surgeMultiplier;

    return res.json({
      drivers,
      estimate: {
        vehicleType: vehicleType || 'mini',
        distanceKm: Math.round(distanceKmVal * 100) / 100,
        estimatedFare: Math.round(estimatedFare * 100) / 100,
        fareBreakdown
      }
    });
  } catch (e) {
    return res.status(500).json({ message: `Failed to discover drivers and estimate fare: ${e.message}` });
  }
}

module.exports.discoverAndEstimate = discoverAndEstimate;

