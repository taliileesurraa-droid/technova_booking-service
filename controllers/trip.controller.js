const { TripHistory, Booking } = require('../models/bookingModels');
const { Passenger, Driver } = require('../models/userModels');
const { Types } = require('mongoose');

function toBasicUser(u) {
  if (!u) return undefined;
  return {
    id: String(u._id || u.id),
    name: u.name,
    phone: u.phone,
    email: u.email
  };
}

exports.list = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = {};
    const userType = String(req.user?.type || '').toLowerCase();
    if (userType === 'driver') query.driverId = String(req.user.id);
    if (userType === 'passenger') query.passengerId = String(req.user.id);
    if (status) query.status = status;

    const rows = await TripHistory.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await TripHistory.countDocuments(query);

    const passengerIds = [...new Set(rows.map(r => r.passengerId).filter(Boolean))];
    const driverIds = [...new Set(rows.map(r => r.driverId).filter(Boolean))];
    const bookingIds = rows.map(r => r.bookingId).filter(Boolean);

    const validPassengerIds = passengerIds.filter(id => Types.ObjectId.isValid(id));
    const validDriverIds = driverIds.filter(id => Types.ObjectId.isValid(id));
    const validBookingIds = bookingIds.filter(id => Types.ObjectId.isValid(id));

    const [passengers, drivers, bookings] = await Promise.all([
      validPassengerIds.length ? Passenger.find({ _id: { $in: validPassengerIds } }).select({ _id: 1, name: 1, phone: 1, email: 1 }).lean() : Promise.resolve([]),
      validDriverIds.length ? Driver.find({ _id: { $in: validDriverIds } }).select({ _id: 1, name: 1, phone: 1, email: 1, vehicleType: 1 }).lean() : Promise.resolve([]),
      validBookingIds.length ? Booking.find({ _id: { $in: validBookingIds } }).select({ _id: 1, pickup: 1, dropoff: 1, vehicleType: 1, passengerName: 1, passengerPhone: 1 }).lean() : Promise.resolve([])
    ]);

    const pidMap = Object.fromEntries(passengers.map(p => [String(p._id), p]));
    const didMap = Object.fromEntries(drivers.map(d => [String(d._id), d]));
    const bidMap = Object.fromEntries(bookings.map(b => [String(b._id), b]));

    const data = rows.map(r => {
      const b = bidMap[String(r.bookingId)];
      return {
        id: String(r._id),
        bookingId: String(r.bookingId),
        driverId: r.driverId && String(r.driverId),
        passengerId: r.passengerId && String(r.passengerId),
        status: r.status,
        dateOfTravel: r.dateOfTravel,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        passenger: toBasicUser(pidMap[String(r.passengerId)]) || (b ? { id: String(r.passengerId), name: b.passengerName, phone: b.passengerPhone } : undefined),
        driver: toBasicUser(didMap[String(r.driverId)]),
        booking: b ? {
          id: String(b._id),
          vehicleType: b.vehicleType,
          pickup: b.pickup,
          dropoff: b.dropoff
        } : undefined
      };
    });

    return res.json({
      trips: data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (e) {
    return res.status(500).json({ message: `Failed to list trips: ${e.message}` });
  }
};

exports.get = async (req, res) => {
  try {
    const r = await TripHistory.findById(req.params.id).lean();
    if (!r) return res.status(404).json({ message: 'Trip not found' });

    const [p, d, b] = await Promise.all([
      (r.passengerId && Types.ObjectId.isValid(r.passengerId)) ? Passenger.findById(r.passengerId).select({ _id: 1, name: 1, phone: 1, email: 1 }).lean() : null,
      (r.driverId && Types.ObjectId.isValid(r.driverId)) ? Driver.findById(r.driverId).select({ _id: 1, name: 1, phone: 1, email: 1, vehicleType: 1 }).lean() : null,
      (r.bookingId && Types.ObjectId.isValid(r.bookingId)) ? Booking.findById(r.bookingId).select({ _id: 1, pickup: 1, dropoff: 1, vehicleType: 1, passengerName: 1, passengerPhone: 1 }).lean() : null
    ]);

    const data = {
      id: String(r._id),
      bookingId: String(r.bookingId),
      driverId: r.driverId && String(r.driverId),
      passengerId: r.passengerId && String(r.passengerId),
      status: r.status,
      dateOfTravel: r.dateOfTravel,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      passenger: toBasicUser(p) || (b ? { id: String(r.passengerId), name: b.passengerName, phone: b.passengerPhone } : undefined),
      driver: toBasicUser(d),
      booking: b ? {
        id: String(b._id),
        vehicleType: b.vehicleType,
        pickup: b.pickup,
        dropoff: b.dropoff
      } : undefined
    };

    return res.json(data);
  } catch (e) {
    return res.status(500).json({ message: `Failed to get trip: ${e.message}` });
  }
};

exports.create = async (req, res) => {
  try {
    const { 
      bookingId, 
      driverId, 
      passengerId, 
      status = 'completed', 
      fare, 
      distance, 
      duration, 
      pickupLocation, 
      dropoffLocation, 
      startTime, 
      endTime, 
      notes 
    } = req.body;

    if (!bookingId || !driverId || !passengerId) {
      return res.status(400).json({ message: 'bookingId, driverId, and passengerId are required' });
    }

    const trip = new TripHistory({
      bookingId,
      driverId,
      passengerId,
      status,
      fare,
      distance,
      duration,
      pickupLocation,
      dropoffLocation,
      startTime: startTime ? new Date(startTime) : new Date(),
      endTime: endTime ? new Date(endTime) : new Date(),
      dateOfTravel: new Date(),
      notes
    });

    await trip.save();

    return res.status(201).json({
      id: String(trip._id),
      bookingId: String(trip.bookingId),
      driverId: String(trip.driverId),
      passengerId: String(trip.passengerId),
      status: trip.status,
      fare: trip.fare,
      distance: trip.distance,
      duration: trip.duration,
      pickupLocation: trip.pickupLocation,
      dropoffLocation: trip.dropoffLocation,
      startTime: trip.startTime,
      endTime: trip.endTime,
      dateOfTravel: trip.dateOfTravel,
      notes: trip.notes,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt
    });
  } catch (e) {
    return res.status(500).json({ message: `Failed to create trip: ${e.message}` });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      status, 
      fare, 
      distance, 
      duration, 
      pickupLocation, 
      dropoffLocation, 
      startTime, 
      endTime, 
      notes 
    } = req.body;

    const trip = await TripHistory.findById(id);
    if (!trip) {
      return res.status(404).json({ message: 'Trip not found' });
    }

    // Update fields if provided
    if (status) trip.status = status;
    if (fare !== undefined) trip.fare = fare;
    if (distance !== undefined) trip.distance = distance;
    if (duration !== undefined) trip.duration = duration;
    if (pickupLocation) trip.pickupLocation = pickupLocation;
    if (dropoffLocation) trip.dropoffLocation = dropoffLocation;
    if (startTime) trip.startTime = new Date(startTime);
    if (endTime) trip.endTime = new Date(endTime);
    if (notes !== undefined) trip.notes = notes;

    trip.updatedAt = new Date();
    await trip.save();

    return res.json({
      id: String(trip._id),
      bookingId: String(trip.bookingId),
      driverId: String(trip.driverId),
      passengerId: String(trip.passengerId),
      status: trip.status,
      fare: trip.fare,
      distance: trip.distance,
      duration: trip.duration,
      pickupLocation: trip.pickupLocation,
      dropoffLocation: trip.dropoffLocation,
      startTime: trip.startTime,
      endTime: trip.endTime,
      dateOfTravel: trip.dateOfTravel,
      notes: trip.notes,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt
    });
  } catch (e) {
    return res.status(500).json({ message: `Failed to update trip: ${e.message}` });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const trip = await TripHistory.findById(id);
    if (!trip) {
      return res.status(404).json({ message: 'Trip not found' });
    }

    await TripHistory.findByIdAndDelete(id);

    return res.json({ message: 'Trip deleted successfully' });
  } catch (e) {
    return res.status(500).json({ message: `Failed to delete trip: ${e.message}` });
  }
};


