async function calculateFare(distanceKm, waitingTimeMinutes, vehicleType, surgeMultiplier = 1, discount = 0) {
  const baseRates = { mini: 0.5, sedan: 0.7, suv: 1.0 };
  const waitingRate = 0.1;
  const ratePerKm = baseRates[vehicleType] || baseRates['mini'];

  let fare = (Number(distanceKm || 0) * ratePerKm) + (Number(waitingTimeMinutes || 0) * waitingRate);
  fare *= Number(surgeMultiplier || 1);
  fare -= Number(discount || 0);
  return Math.max(fare, 2);
}

module.exports = { calculateFare };

