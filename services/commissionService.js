async function calculateCommission(fare, rate = 0.15) {
  const commission = Number(fare || 0) * Number(rate || 0.15);
  const driverEarnings = Number(fare || 0) - commission;
  return { commission, driverEarnings };
}

module.exports = { calculateCommission };

