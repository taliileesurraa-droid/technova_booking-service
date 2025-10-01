// Shared registry to deduplicate booking:new dispatches to the same driver per booking
// Key format: `${bookingId}:${driverId}`
const dispatchedBookingToDriver = new Map();
// Default TTL extended to 24h to strongly enforce one-time send per driver per booking
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DISPATCH_TTL_MS = Number.parseInt(process.env.DISPATCH_TTL_MS || `${DEFAULT_TTL_MS}`, 10);

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

module.exports = { markDispatched, wasDispatched };

