// Runtime registry for connected drivers and their socket-level availability
// Structure:
// driverId -> { socketIds: Set<string>, availableSockets: Set<string> }

const drivers = new Map();

function ensureDriver(driverId) {
  const id = String(driverId);
  if (!drivers.has(id)) {
    drivers.set(id, { socketIds: new Set(), availableSockets: new Set() });
  }
  return drivers.get(id);
}

function registerSocket(driverId, socketId) {
  const entry = ensureDriver(driverId);
  entry.socketIds.add(String(socketId));
}

function unregisterSocket(driverId, socketId) {
  const id = String(driverId);
  const entry = drivers.get(id);
  if (!entry) return;
  entry.socketIds.delete(String(socketId));
  entry.availableSockets.delete(String(socketId));
  if (entry.socketIds.size === 0 && entry.availableSockets.size === 0) {
    drivers.delete(id);
  }
}

function setSocketAvailability(driverId, socketId, available) {
  const entry = ensureDriver(driverId);
  const sid = String(socketId);
  if (available) {
    entry.availableSockets.add(sid);
  } else {
    entry.availableSockets.delete(sid);
  }
}

function isDriverAvailableBySocket(driverId) {
  const entry = drivers.get(String(driverId));
  return !!(entry && entry.availableSockets && entry.availableSockets.size > 0);
}

module.exports = {
  registerSocket,
  unregisterSocket,
  setSocketAvailability,
  isDriverAvailableBySocket,
};

