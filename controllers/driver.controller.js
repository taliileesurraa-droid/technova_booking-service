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
        .select('_id name phone email vehicleType available lastKnownLocation rating externalId createdAt updatedAt paymentPreferences paymentPreference')
        .populate([
          { path: 'paymentPreferences', select: { name: 1, logo: 1 } },
          { path: 'paymentPreference', select: { name: 1, logo: 1 } }
        ])
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
        paymentPreferences: (() => {
          // Handle both old paymentPreference and new paymentPreferences
          let prefs = [];
          if (driver.paymentPreferences && Array.isArray(driver.paymentPreferences)) {
            prefs = driver.paymentPreferences;
          } else if (driver.paymentPreference) {
            prefs = [driver.paymentPreference];
          }
          return prefs.map(pref => ({
            _id: String(pref._id),
            name: pref.name,
            logo: pref.logo
          }));
        })(),
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
      let selectedIds = [];
      
      try {
        // Try to find driver preferences - check multiple sources
        let driver = null;
        
        // First, try to get driver from JWT token
        if (req.user && req.user.id) {
          console.log('Looking for driver with JWT user ID:', req.user.id);
          driver = await Driver.findById(String(req.user.id)).select({ paymentPreferences: 1, paymentPreference: 1 }).lean();
          
          // If not found by _id, try by externalId
          if (!driver) {
            driver = await Driver.findOne({ externalId: String(req.user.id) }).select({ paymentPreferences: 1, paymentPreference: 1 }).lean();
          }
        }
        
        // If still not found, try to find by email/phone from token
        if (!driver && req.user && (req.user.email || req.user.phone || req.user.phoneNumber)) {
          console.log('Trying to find driver by email/phone');
          driver = await Driver.findOne({
            $or: [
              { email: req.user.email || null },
              { phone: req.user.phone || req.user.phoneNumber || req.user.mobile || null }
            ]
          }).select({ paymentPreferences: 1, paymentPreference: 1 }).lean();
        }
        
        console.log('Driver found:', driver ? 'yes' : 'no');
        if (driver) {
          console.log('Driver payment preferences:', {
            paymentPreferences: driver.paymentPreferences,
            paymentPreference: driver.paymentPreference
          });
          
          // Handle both old and new format
          let preferences = [];
          if (driver.paymentPreferences && Array.isArray(driver.paymentPreferences)) {
            preferences = driver.paymentPreferences;
          } else if (driver.paymentPreference) {
            preferences = [driver.paymentPreference];
          }
          
          selectedIds = preferences.map(id => String(id));
          console.log('Selected payment option IDs:', selectedIds);
        }
      } catch (e) {
        console.error('Error fetching driver payment preferences:', e);
      }
      
      const data = (rows || []).map(o => {
        const optionId = String(o._id || o.id);
        const isSelected = selectedIds.includes(optionId);
        return { 
          id: optionId, 
          name: o.name, 
          logo: o.logo, 
          selected: isSelected
        };
      });
      
      console.log('Payment options response summary:', {
        totalOptions: data.length,
        selectedCount: data.filter(d => d.selected).length,
        selectedOptions: data.filter(d => d.selected).map(d => d.name)
      });
      
      return res.json(data);
    } catch (e) { errorHandler(res, e); }
  },
  setPaymentPreference: async (req, res) => {
    try {
      let { paymentOptionId, driverId, id, action = 'add' } = req.body || {};
      // Accept `id` as an alias for `paymentOptionId` for convenience
      if (!paymentOptionId && id) paymentOptionId = id;
      const actingIsDriver = req.user && req.user.type === 'driver';
      const actingIsAdmin = req.user && (req.user.type === 'admin' || (Array.isArray(req.user.roles) && req.user.roles.includes('superadmin')));
      const targetDriverId = actingIsDriver ? String(req.user.id) : String(driverId || '');
      if (!actingIsDriver && !actingIsAdmin) return res.status(403).json({ message: 'Forbidden: driver or admin required' });
      if (!paymentOptionId) return res.status(400).json({ message: 'paymentOptionId is required' });
      if (!targetDriverId) return res.status(400).json({ message: 'driverId is required for admin to set preference' });
      
      let updated;
      if (action === 'remove') {
        updated = await paymentService.removeDriverPaymentPreference(targetDriverId, paymentOptionId);
      } else {
        updated = await paymentService.setDriverPaymentPreference(targetDriverId, paymentOptionId);
      }
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

    const latitude = pickup.latitude;
    const longitude = pickup.longitude;
    const result = await require('../services/bookingService').listNearbyBookings({
      latitude,
      longitude,
      radiusKm,
      vehicleType,
      limit: 20,
      driverId: req.user && req.user.type === 'driver' ? String(req.user.id) : undefined,
      headers: req.headers || {}
    });
    res.json(result);
  } catch (e) { errorHandler(res, e); }
}

module.exports.discoverAndEstimate = discoverAndEstimate;

