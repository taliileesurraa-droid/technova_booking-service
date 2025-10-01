const geolib = require('geolib');
const { Passenger } = require('../models/userModels');

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

async function nearestPassengers({ latitude, longitude, limit = 5 }) {
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    throw new Error('Valid latitude and longitude are required');
  }
  const max = Math.max(1, Math.min(parseInt(limit || 5, 10), 50));

  // Assuming Passenger collection may store last known location in a similar structure.
  // If not available, this will return an empty list safely.
  const passengers = await Passenger.find({ 'lastKnownLocation.latitude': { $exists: true }, 'lastKnownLocation.longitude': { $exists: true } }).lean().catch(() => []);
  const withDistance = (passengers || [])
    .map(p => {
      const loc = p.lastKnownLocation || {};
      if (!isFiniteNumber(loc.latitude) || !isFiniteNumber(loc.longitude)) return null;
      const distanceKm = geolib.getDistance(
        { latitude: lat, longitude: lng },
        { latitude: loc.latitude, longitude: loc.longitude }
      ) / 1000;
      if (!isFiniteNumber(distanceKm)) return null;
      return { passenger: p, distanceKm };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, max);

  return withDistance;
}

module.exports = { nearestPassengers };
