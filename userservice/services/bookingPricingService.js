const { Pricing } = require('../models/pricing');
const { Booking } = require('../models/bookingModels');
const geolib = require('geolib');

async function recalcForBooking(bookingId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }

  const distanceKm = geolib.getDistance(
    { latitude: booking.pickup.latitude, longitude: booking.pickup.longitude },
    { latitude: booking.dropoff.latitude, longitude: booking.dropoff.longitude }
  ) / 1000;

  const p = await Pricing.findOne({ vehicleType: booking.vehicleType, isActive: true }).sort({ updatedAt: -1 });
  if (!p) {
    const err = new Error('Active pricing not found for vehicleType');
    err.status = 404;
    throw err;
  }

  const fareBreakdown = {
    base: p.baseFare,
    distanceCost: distanceKm * p.perKm,
    timeCost: 0,
    waitingCost: 0,
    surgeMultiplier: p.surgeMultiplier,
  };
  const fareEstimated = (fareBreakdown.base + fareBreakdown.distanceCost + fareBreakdown.timeCost + fareBreakdown.waitingCost) * fareBreakdown.surgeMultiplier;

  booking.distanceKm = distanceKm;
  booking.fareEstimated = fareEstimated;
  booking.fareBreakdown = fareBreakdown;
  await booking.save();

  return {
    bookingId: String(booking._id),
    vehicleType: booking.vehicleType,
    distanceKm,
    fareEstimated,
    fareBreakdown
  };
}

module.exports = { recalcForBooking };

