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

    // Fetch trip histories
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

    // Fetch passengers, drivers, and bookings
    const [passengers, drivers, bookings] = await Promise.all([
      validPassengerIds.length ? Passenger.find({ _id: { $in: validPassengerIds } }).select({ _id: 1, name: 1, phone: 1, email: 1 }).lean() : Promise.resolve([]),
      validDriverIds.length ? Driver.find({ _id: { $in: validDriverIds } }).select({ _id: 1, name: 1, phone: 1, email: 1, vehicleType: 1 }).lean() : Promise.resolve([]),
      validBookingIds.length ? Booking.find({ _id: { $in: validBookingIds } }).select({ _id: 1, pickup: 1, dropoff: 1, vehicleType: 1, passengerName: 1, passengerPhone: 1 }).lean() : Promise.resolve([])
    ]);

    const pidMap = Object.fromEntries(passengers.map(p => [String(p._id), p]));
    const didMap = Object.fromEntries(drivers.map(d => [String(d._id), d]));
    const bidMap = Object.fromEntries(bookings.map(b => [String(b._id), b]));

    // Fetch extra driver info for non-ObjectId driverIds
    let extraDriverInfo = {};
    try {
      const nonObjectDriverIds = driverIds.filter(id => !Types.ObjectId.isValid(id));
      if (nonObjectDriverIds.length) {
        const { getDriversByIds } = require('../integrations/userServiceClient');
        const headers = req.headers && req.headers.authorization ? { Authorization: req.headers.authorization } : undefined;
        const infos = await getDriversByIds(nonObjectDriverIds, { headers });
        extraDriverInfo = Object.fromEntries((infos || []).map(i => [String(i.id), { id: String(i.id), name: i.name, phone: i.phone, email: i.email }]));
      }
    } catch (_) {}

    // Map trips with passenger, driver, and booking info
    const data = rows.map(r => {
      const b = bidMap[String(r.bookingId)];

      let driverDetail = toBasicUser(didMap[String(r.driverId)]) || extraDriverInfo[String(r.driverId)];

      // fallback to logged-in user if driverId matches request user
      if (!driverDetail && String(req.user?.id) === String(r.driverId)) {
        driverDetail = {
          id: String(r.driverId),
          name: req.user?.name,
          phone: req.user?.phone,
          email: req.user?.email
        };
      }

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
        driver: driverDetail,
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
