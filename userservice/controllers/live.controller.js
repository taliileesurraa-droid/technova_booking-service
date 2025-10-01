const { Live } = require('../models/bookingModels');
const { crudController } = require('./basic.crud');
const { broadcast } = require('../sockets/utils');

const base = crudController(Live);

async function push(req, res) {
  try {
    const userType = req.user?.type;
    const userIdStr = String(req.user?.id || '');
    const { latitude, longitude, status, tripId, locationType, bookingId } = req.body || {};
    
    // Validate required fields
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ message: 'latitude and longitude are required numbers' });
    }
    
    // Validate locationType enum
    if (!locationType || !['pickup', 'dropoff', 'current'].includes(locationType)) {
      return res.status(400).json({ 
        message: 'locationType is required and must be one of: pickup, dropoff, current' 
      });
    }
    
    // For passengers, validate booking if updating pickup/dropoff location
    if (userType === 'passenger' && ['pickup', 'dropoff'].includes(locationType)) {
      if (!bookingId) {
        return res.status(400).json({ 
          message: 'bookingId is required when updating pickup or dropoff location' 
        });
      }
      
      const { Booking } = require('../models/bookingModels');
      const booking = await Booking.findById(bookingId);
      if (!booking || booking.passengerId !== String(req.user.id)) {
        return res.status(403).json({ message: 'Invalid booking or permission denied' });
      }
      
      // Update booking with new location
      if (locationType === 'pickup') {
        booking.pickup = { latitude, longitude };
      } else if (locationType === 'dropoff') {
        booking.dropoff = { latitude, longitude };
      }
      await booking.save();
    }
    
    // Normalize status to match Live schema enum
    const allowedStatuses = ['moving','stopped','offline'];
    let normalizedStatus = status;
    if (status === 'ongoing') normalizedStatus = 'moving';
    if (status === 'completed') normalizedStatus = 'stopped';
    // Do not force a default. Let validation run if the input is invalid.

    // Create position update payload
    const payload = { 
      tripId, 
      latitude, 
      longitude, 
      status: normalizedStatus, 
      locationType, 
      bookingId 
    };
    
    // Set user ID based on user type
    if (userType === 'driver') {
      payload.driverId = userIdStr;
    } else if (userType === 'passenger') {
      payload.passengerId = userIdStr;
    }
    
    const item = await Live.create(payload);
    
    // Add basic user information based on user type
    let userInfo = null;
    if (userType === 'passenger' && item.passengerId) {
      // Extract passenger info from JWT token
      userInfo = {
        id: String(req.user.id),
        name: req.user.name || req.user.fullName || req.user.displayName,
        phone: req.user.phone || req.user.phoneNumber || req.user.mobile,
        email: req.user.email
      };
    } else if (userType === 'driver' && item.driverId) {
      // Extract driver info from JWT token
      userInfo = {
        id: String(req.user.id),
        name: req.user.name || req.user.fullName || req.user.displayName,
        phone: req.user.phone || req.user.phoneNumber || req.user.mobile,
        email: req.user.email,
        vehicleType: req.user.vehicleType
      };
    }
    
    const plain = {
      id: String(item._id),
      driverId: item.driverId,
      passengerId: item.passengerId,
      latitude: item.latitude,
      longitude: item.longitude,
      status: item.status,
      locationType: item.locationType,
      bookingId: item.bookingId,
      tripId: item.tripId,
      timestamp: item.timestamp,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ...(userInfo && { [userType]: userInfo })
    };
    
    // Broadcast appropriate events based on location type
    if (locationType === 'pickup') {
      broadcast('passenger:pickup_location', item);
    } else if (locationType === 'dropoff') {
      broadcast('passenger:dropoff_location', item);
    } else {
      broadcast('user:position', item);
    }
    
    return res.status(201).json(plain);
  } catch (e) { 
    return res.status(500).json({ message: `Failed to update position: ${e.message}` }); 
  }
}

module.exports = { ...base, push };

