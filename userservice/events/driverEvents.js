const { broadcast, getIo } = require('../sockets/utils');

function emitDriverLocationUpdate(payload) {
  try {
    broadcast('driver:location', payload);
    const io = getIo && getIo();
    if (io && payload && payload.driverId) {
      io.emit(`driver:location:${String(payload.driverId)}`, payload);
      broadcast('driver:position', payload);
    }
  } catch (_) {}
}

function emitDriverAvailability(driverId, available) {
  try {
    const io = getIo && getIo();
    if (io) io.to(`driver:${String(driverId)}`).emit('driver:availability', { driverId: String(driverId), available });
  } catch (_) {}
}

module.exports = { emitDriverLocationUpdate, emitDriverAvailability };

