const geolib = require('geolib');

const VEHICLE_SPEED_KMH = {
  mini: 35,
  sedan: 40,
  van: 30,
  car: 40
};

function computeDistanceKm(from, to) {
  try {
    const meters = geolib.getDistance(
      { latitude: +from.latitude, longitude: +from.longitude },
      { latitude: +to.latitude, longitude: +to.longitude }
    );
    return meters / 1000;
  } catch (_) { return null; }
}

async function getRoute({ from, to, vehicle = 'car' }) {
  const distanceKm = computeDistanceKm(from, to);
  const speedKmh = VEHICLE_SPEED_KMH[vehicle] || VEHICLE_SPEED_KMH.car;
  const durationMinutes = distanceKm != null ? Math.ceil((distanceKm / speedKmh) * 60) : null;
  return {
    from,
    to,
    vehicle,
    distanceKm,
    durationMinutes,
    path: [from, to]
  };
}

async function getEta({ from, to, vehicle = 'car' }) {
  const route = await getRoute({ from, to, vehicle });
  return { vehicle, distanceKm: route.distanceKm, etaMinutes: route.durationMinutes };
}

module.exports = { getRoute, getEta };

