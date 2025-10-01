const geolib = require('geolib');
const { Driver } = require('../models/userModels');
const { Pricing } = require('../models/pricing');
const { Commission } = require('../models/commission');

async function setAvailability(driverId, available, tokenUser) {
  const inferredName = tokenUser?.name || tokenUser?.fullName || tokenUser?.displayName || tokenUser?.user?.name || tokenUser?.user?.fullName || tokenUser?.user?.displayName;
  const inferredPhone = tokenUser?.phone || tokenUser?.phoneNumber || tokenUser?.mobile || tokenUser?.user?.phone || tokenUser?.user?.phoneNumber || tokenUser?.user?.mobile;
  const inferredEmail = tokenUser?.email || tokenUser?.user?.email;
  const inferredVehicleType = tokenUser?.vehicleType || tokenUser?.user?.vehicleType;
  const inferredExternalId = tokenUser?.externalId || tokenUser?.sub || tokenUser?.user?.externalId || tokenUser?.user?.id;

  const d = await Driver.findByIdAndUpdate(
    driverId,
    {
      $set: {
        available: !!available,
        ...(inferredName ? { name: inferredName } : {}),
        ...(inferredPhone ? { phone: inferredPhone } : {}),
        ...(inferredEmail ? { email: inferredEmail } : {}),
        ...(inferredVehicleType ? { vehicleType: inferredVehicleType } : {}),
        ...(inferredExternalId ? { externalId: String(inferredExternalId) } : {})
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (!d) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }
  return d;
}

async function updateLocation(driverId, locationBody, tokenUser) {
  const { latitude, longitude, bearing } = locationBody;
  const locationUpdate = { latitude, longitude };
  if (bearing !== undefined && bearing >= 0 && bearing <= 360) locationUpdate.bearing = bearing;

  const inferredName = tokenUser?.name || tokenUser?.fullName || tokenUser?.displayName || tokenUser?.user?.name || tokenUser?.user?.fullName || tokenUser?.user?.displayName;
  const inferredPhone = tokenUser?.phone || tokenUser?.phoneNumber || tokenUser?.mobile || tokenUser?.user?.phone || tokenUser?.user?.phoneNumber || tokenUser?.user?.mobile;
  const inferredEmail = tokenUser?.email || tokenUser?.user?.email;
  const inferredVehicleType = tokenUser?.vehicleType || tokenUser?.user?.vehicleType;
  const inferredExternalId = tokenUser?.externalId || tokenUser?.sub || tokenUser?.user?.externalId || tokenUser?.user?.id;

  const d = await Driver.findByIdAndUpdate(
    driverId,
    {
      $set: {
        lastKnownLocation: locationUpdate,
        ...(inferredName ? { name: inferredName } : {}),
        ...(inferredPhone ? { phone: inferredPhone } : {}),
        ...(inferredEmail ? { email: inferredEmail } : {}),
        ...(inferredVehicleType ? { vehicleType: inferredVehicleType } : {}),
        ...(inferredExternalId ? { externalId: String(inferredExternalId) } : {})
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (!d) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }
  return d;
}

function distanceKm(a, b) {
  if (!a || !b || a.latitude == null || b.latitude == null) return Number.POSITIVE_INFINITY;
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const aHarv = Math.sin(dLat/2)**2 + Math.sin(dLon/2)**2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(aHarv));
}

async function availableNearby({ latitude, longitude, radiusKm = 5, vehicleType }) {
  const all = await Driver.find({ available: true, ...(vehicleType ? { vehicleType } : {}) });
  const latNum = Number(latitude);
  const lonNum = Number(longitude);
  const rKm = Number(radiusKm);
  const lons = all.map(d => (d.lastKnownLocation && Number.isFinite(d.lastKnownLocation.longitude) ? d.lastKnownLocation.longitude : null)).filter(v => v != null);
  const negCount = lons.filter(v => v < 0).length;
  const posCount = lons.length - negCount;
  const expectedLonSign = negCount >= posCount ? -1 : 1;
  const candidates = [
    { lat: latNum, lon: lonNum },
    { lat: lonNum, lon: latNum },
    { lat: latNum, lon: expectedLonSign * Math.abs(lonNum) },
    { lat: lonNum, lon: expectedLonSign * Math.abs(latNum) }
  ];
  function countWithin(target) {
    const distances = all
      .filter(d => d.lastKnownLocation)
      .map(d => distanceKm(d.lastKnownLocation, { latitude: target.lat, longitude: target.lon }));
    const inRange = distances.filter(d => d <= rKm);
    const avg = inRange.length ? (inRange.reduce((a, b) => a + b, 0) / inRange.length) : Number.POSITIVE_INFINITY;
    return { count: inRange.length, avg };
  }
  let chosen = candidates[0];
  let bestScore = { count: -1, avg: Number.POSITIVE_INFINITY };
  for (const c of candidates) {
    const score = countWithin(c);
    if (score.count > bestScore.count || (score.count === bestScore.count && score.avg < bestScore.avg)) {
      bestScore = score;
      chosen = c;
    }
  }
  const nearby = all.filter(d => d.lastKnownLocation && distanceKm(d.lastKnownLocation, { latitude: chosen.lat, longitude: chosen.lon }) <= rKm);
  return nearby.map(driver => ({
    id: String(driver._id),
    driverId: String(driver._id),
    vehicleType: driver.vehicleType,
    rating: driver.rating || 5.0,
    lastKnownLocation: driver.lastKnownLocation ? {
      latitude: driver.lastKnownLocation.latitude,
      longitude: driver.lastKnownLocation.longitude,
      bearing: driver.lastKnownLocation.bearing || null
    } : null,
    distanceKm: distanceKm(driver.lastKnownLocation, { latitude: chosen.lat, longitude: chosen.lon })
  }));
}

async function estimateFareForPassenger({ vehicleType = 'mini', pickup, dropoff }) {
  if (!pickup || !dropoff) {
    const err = new Error('Pickup and dropoff locations are required');
    err.status = 400;
    throw err;
  }
  if (!pickup.latitude || !pickup.longitude || !dropoff.latitude || !dropoff.longitude) {
    const err = new Error('Valid latitude and longitude are required for both pickup and dropoff');
    err.status = 400;
    throw err;
  }
  const distanceKmVal = geolib.getDistance(
    { latitude: pickup.latitude, longitude: pickup.longitude },
    { latitude: dropoff.latitude, longitude: dropoff.longitude }
  ) / 1000;
  const pricing = await Pricing.findOne({ vehicleType, isActive: true }).sort({ updatedAt: -1 });
  if (!pricing) {
    const err = new Error(`No pricing found for vehicle type: ${vehicleType}`);
    err.status = 404;
    throw err;
  }
  const fareBreakdown = {
    base: pricing.baseFare,
    distanceCost: distanceKmVal * pricing.perKm,
    timeCost: 0,
    waitingCost: 0,
    surgeMultiplier: pricing.surgeMultiplier
  };
  const estimatedFare = (fareBreakdown.base + fareBreakdown.distanceCost + fareBreakdown.timeCost + fareBreakdown.waitingCost) * fareBreakdown.surgeMultiplier;
  return {
    vehicleType,
    distanceKm: Math.round(distanceKmVal * 100) / 100,
    estimatedFare: Math.round(estimatedFare * 100) / 100,
    fareBreakdown,
    pricing: {
      baseFare: pricing.baseFare,
      perKm: pricing.perKm,
      perMinute: pricing.perMinute,
      waitingPerMinute: pricing.waitingPerMinute,
      surgeMultiplier: pricing.surgeMultiplier
    }
  };
}

async function estimateFareForDriver(booking) {
  let distanceKmVal = booking.distanceKm;
  if (!distanceKmVal && booking.pickup && booking.dropoff) {
    distanceKmVal = geolib.getDistance(
      { latitude: booking.pickup.latitude, longitude: booking.pickup.longitude },
      { latitude: booking.dropoff.latitude, longitude: booking.dropoff.longitude }
    ) / 1000;
  }
  const pricing = await Pricing.findOne({ vehicleType: booking.vehicleType, isActive: true }).sort({ updatedAt: -1 });
  if (!pricing) {
    const err = new Error(`No pricing found for vehicle type: ${booking.vehicleType}`);
    err.status = 404;
    throw err;
  }
  const fareBreakdown = {
    base: pricing.baseFare,
    distanceCost: distanceKmVal * pricing.perKm,
    timeCost: 0,
    waitingCost: 0,
    surgeMultiplier: pricing.surgeMultiplier
  };
  const estimatedFare = (fareBreakdown.base + fareBreakdown.distanceCost + fareBreakdown.timeCost + fareBreakdown.waitingCost) * fareBreakdown.surgeMultiplier;
  const commissionDoc = booking.driverId ? await Commission.findOne({ driverId: String(booking.driverId) }).sort({ createdAt: -1 }) : null;
  const commissionRate = commissionDoc && Number.isFinite(commissionDoc.percentage) ? commissionDoc.percentage : Number(process.env.COMMISSION_RATE || 15);
  const grossFare = estimatedFare;
  const commissionAmount = (grossFare * commissionRate) / 100;
  const netEarnings = grossFare - commissionAmount;
  return {
    distanceKm: Math.round(distanceKmVal * 100) / 100,
    estimatedFare: Math.round(estimatedFare * 100) / 100,
    fareBreakdown,
    driverEarnings: {
      grossFare: Math.round(grossFare * 100) / 100,
      commissionRate,
      commissionAmount: Math.round(commissionAmount * 100) / 100,
      netEarnings: Math.round(netEarnings * 100) / 100
    }
  };
}

module.exports = {
  setAvailability,
  updateLocation,
  availableNearby,
  estimateFareForPassenger,
  estimateFareForDriver
};

