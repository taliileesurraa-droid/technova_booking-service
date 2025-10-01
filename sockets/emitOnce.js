// Simple in-memory emit-once guard for a given event+bookingId
// TTL defaults to 10 minutes; configurable via EMIT_ONCE_TTL_MS
const EMITTED = new Map();
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const TTL = Number.parseInt(process.env.EMIT_ONCE_TTL_MS || `${DEFAULT_TTL_MS}`, 10);

function keyOf(eventName, bookingId) {
  return `${String(eventName)}::${String(bookingId)}`;
}

function wasEmitted(eventName, bookingId) {
  const key = keyOf(eventName, bookingId);
  const ts = EMITTED.get(key);
  if (!ts) return false;
  if (Date.now() - ts > TTL) {
    EMITTED.delete(key);
    return false;
  }
  return true;
}

function markEmitted(eventName, bookingId) {
  EMITTED.set(keyOf(eventName, bookingId), Date.now());
}

module.exports = { wasEmitted, markEmitted };

