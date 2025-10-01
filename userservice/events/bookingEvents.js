const { broadcast, sendMessageToSocketId } = require('../sockets/utils');

function emitBookingCreatedToNearestPassengers(payload, targets) {
  try {
    broadcast('booking:new:broadcast', { ...payload, targetedCount: targets.length, target: 'passengers' });
    targets.forEach(p => sendMessageToSocketId(`passenger:${String(p._id)}`, { event: 'booking:new', data: payload }));
  } catch (e) {}
}

function emitBookingUpdate(bookingId, patch) {
  try {
    broadcast('booking:update', { id: bookingId, bookingId, ...patch });
  } catch (_) {}
}

function emitBookingAssigned(bookingId, driverId) {
  try {
    broadcast('booking:assigned', { bookingId, driverId });
  } catch (_) {}
}

module.exports = {
  emitBookingCreatedToNearestPassengers,
  emitBookingUpdate,
  emitBookingAssigned
};

function emitTripStarted(io, booking) {
  try {
    const payload = { id: String(booking._id), bookingId: String(booking._id), startedAt: booking.startedAt, startLocation: booking.startLocation };
    io.to(`booking:${String(booking._id)}`).emit('trip_started', payload);
  } catch (_) {}
}

function emitTripOngoing(io, booking, location) {
  try {
    const payload = { id: String(booking._id || booking), bookingId: String(booking._id || booking), location };
    io.to(`booking:${String(booking._id || booking)}`).emit('trip_ongoing', payload);
  } catch (_) {}
}

function emitTripCompleted(io, booking) {
  try {
    const payload = {
      id: String(booking._id),
      bookingId: String(booking._id),
      amount: booking.fareFinal || booking.fareEstimated,
      distance: booking.distanceKm,
      waitingTime: booking.waitingTime,
      completedAt: booking.completedAt,
      driverEarnings: booking.driverEarnings,
      commission: booking.commissionAmount
    };
    io.to(`booking:${String(booking._id)}`).emit('trip_completed', payload);
  } catch (_) {}
}

module.exports.emitTripStarted = emitTripStarted;
module.exports.emitTripOngoing = emitTripOngoing;
module.exports.emitTripCompleted = emitTripCompleted;

