const geolib = require('geolib');
const { Driver } = require('../models/userModels');

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

async function driverByLocation({ latitude, longitude, radiusKm = 5 }) {
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  const rad = parseFloat(radiusKm);
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    throw new Error('Valid latitude and longitude are required');
  }
  const radius = isFiniteNumber(rad) ? rad : 5;

  const drivers = await Driver.find({ available: true }).lean();
  const withDistance = drivers
    .map(d => {
      const loc = d.lastKnownLocation || {};
      if (!isFiniteNumber(loc.latitude) || !isFiniteNumber(loc.longitude)) return null;
      const distanceKm = geolib.getDistance(
        { latitude: lat, longitude: lng },
        { latitude: loc.latitude, longitude: loc.longitude }
      ) / 1000;
      if (!isFiniteNumber(distanceKm) || distanceKm > radius) return null;
      return { driver: d, distanceKm };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return withDistance;
}

async function driverByLocationAndVehicleType({ latitude, longitude, vehicleType, radiusKm = 5, limit = 5 }) {
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  const rad = parseFloat(radiusKm);
  const vehicle = vehicleType ? String(vehicleType).toLowerCase() : undefined;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    throw new Error('Valid latitude and longitude are required');
  }
  if (!vehicle) {
    throw new Error('vehicleType is required');
  }
  const radius = isFiniteNumber(rad) ? rad : 5;
  const max = Math.max(1, Math.min(parseInt(limit || 5, 10), 50));

  const drivers = await Driver.find({ available: true, vehicleType: vehicleType }).lean();
  const withDistance = drivers
    .map(d => {
      const loc = d.lastKnownLocation || {};
      if (!isFiniteNumber(loc.latitude) || !isFiniteNumber(loc.longitude)) return null;
      const distanceKm = geolib.getDistance(
        { latitude: lat, longitude: lng },
        { latitude: loc.latitude, longitude: loc.longitude }
      ) / 1000;
      if (!isFiniteNumber(distanceKm) || distanceKm > radius) return null;
      return { driver: d, distanceKm };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, max);

  return withDistance;
}

module.exports = { driverByLocation, driverByLocationAndVehicleType };
