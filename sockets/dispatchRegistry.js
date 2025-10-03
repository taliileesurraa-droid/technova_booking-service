// Shared registry to deduplicate booking:new dispatches to the same driver per booking
// Key format: `${bookingId}:${driverId}`
const dispatchedBookingToDriver = new Map();
// Default TTL extended to 24h to strongly enforce one-time send per driver per booking
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DISPATCH_TTL_MS = Number.parseInt(process.env.DISPATCH_TTL_MS || `${DEFAULT_TTL_MS}`, 10);

// Runtime registry for connected drivers and their socket-level availability
// Structure: driverId -> { socketIds: Set<string>, availableSockets: Set<string> }
const driverConnectionRegistry = new Map();
// Live location cache: driverId -> { latitude, longitude, bearing, updatedAt }
const liveLocationByDriver = new Map();
function ensureDriverEntry(driverId) {
  const id = String(driverId);
  if (!driverConnectionRegistry.has(id)) {
    driverConnectionRegistry.set(id, { socketIds: new Set(), availableSockets: new Set() });
  }
  return driverConnectionRegistry.get(id);
}
function registerSocket(driverId, socketId) {
  const entry = ensureDriverEntry(driverId);
  entry.socketIds.add(String(socketId));
}
function unregisterSocket(driverId, socketId) {
  const id = String(driverId);
  const entry = driverConnectionRegistry.get(id);
  if (!entry) return;
  entry.socketIds.delete(String(socketId));
  entry.availableSockets.delete(String(socketId));
  if (entry.socketIds.size === 0 && entry.availableSockets.size === 0) {
    driverConnectionRegistry.delete(id);
  }
}
function setSocketAvailability(driverId, socketId, available) {
  const entry = ensureDriverEntry(driverId);
  const sid = String(socketId);
  if (available) entry.availableSockets.add(sid); else entry.availableSockets.delete(sid);
}
function isDriverAvailableBySocket(driverId) {
  const entry = driverConnectionRegistry.get(String(driverId));
  return !!(entry && entry.availableSockets && entry.availableSockets.size > 0);
}

function setLiveLocation(driverId, location) {
  if (!location || location.latitude == null || location.longitude == null) return;
  liveLocationByDriver.set(String(driverId), {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    bearing: location.bearing != null ? Number(location.bearing) : undefined,
    updatedAt: Date.now()
  });
}

function getLiveLocation(driverId) {
  return liveLocationByDriver.get(String(driverId));
}

function makeKey(bookingId, driverId) {
  return `${String(bookingId)}:${String(driverId)}`;
}

function markDispatched(bookingId, driverId) {
  const key = makeKey(bookingId, driverId);
  if (!dispatchedBookingToDriver.has(key)) {
    dispatchedBookingToDriver.set(key, Date.now());
  }
}

function wasDispatched(bookingId, driverId) {
  const key = makeKey(bookingId, driverId);
  const ts = dispatchedBookingToDriver.get(key);
  if (!ts) return false;
  if (Date.now() - ts > DISPATCH_TTL_MS) {
    dispatchedBookingToDriver.delete(key);
    return false;
  }
  return true;
}

function cleanupDispatches() {
  const now = Date.now();
  for (const [key, ts] of dispatchedBookingToDriver.entries()) {
    if (now - ts > DISPATCH_TTL_MS) dispatchedBookingToDriver.delete(key);
  }
}

setInterval(cleanupDispatches, DISPATCH_TTL_MS).unref();

module.exports = {
  markDispatched,
  wasDispatched,
  registerSocket,
  unregisterSocket,
  setSocketAvailability,
  isDriverAvailableBySocket,
  setLiveLocation,
  getLiveLocation
};

