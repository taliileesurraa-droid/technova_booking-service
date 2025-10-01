const { getRoute, getEta } = require('../utils/routing');
const { Booking, Live } = require('../models/bookingModels');

exports.route = async (req, res) => {
  try {
    const { from, to, vehicle = 'car' } = req.body;
    if (!from || !to) return res.status(400).json({ message: 'from and to are required' });
    const data = await getRoute({ from, to, vehicle });
    return res.json(data);
  } catch (e) { return res.status(500).json({ message: e.message }); }
}

exports.eta = async (req, res) => {
  try {
    const { from, to, vehicle = 'car' } = req.body;
    if (!from || !to) return res.status(400).json({ message: 'from and to are required' });
    const data = await getEta({ from, to, vehicle });
    return res.json(data);
  } catch (e) { return res.status(500).json({ message: e.message }); }
}

exports.bookingProgress = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Not found' });
    const last = await Live.findOne({ driverId: booking.driverId }).sort({ createdAt: -1 });
    const from = last ? { latitude: last.latitude, longitude: last.longitude } : booking.pickup;
    const to = booking.dropoff;
    const route = await getRoute({ from, to, vehicle: booking.vehicleType });
    // include passenger basic information
    let passenger = undefined;
    if (booking.passengerId) {
      // Try to get passenger info from JWT token first
      if (req.user && req.user.id && req.user.type === 'passenger' && String(req.user.id) === String(booking.passengerId)) {
        // The JWT token now contains passenger data directly
        passenger = {
          id: String(req.user.id),
          name: req.user.name || req.user.fullName || req.user.displayName,
          phone: req.user.phone || req.user.phoneNumber || req.user.mobile,
          email: req.user.email
        };
      } else {
        // Use stored passenger data only if present; otherwise leave undefined
        if (booking.passengerName || booking.passengerPhone) {
          passenger = { 
            id: String(booking.passengerId), 
            name: booking.passengerName, 
            phone: booking.passengerPhone 
          };
        }
      }
    }
    return res.json({ 
      status: booking.status, 
      passenger, 
      lastKnown: last, 
      distanceKm: route.distanceKm, 
      etaMinutes: route.durationMinutes 
    });
  } catch (e) { return res.status(500).json({ message: e.message }); }
}

