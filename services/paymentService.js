const PaymentOption = require('../models/paymentOption');
const { Driver } = require('../models/userModels');

async function getPaymentOptions() {
  return PaymentOption.find({}).select({ name: 1, logo: 1 }).sort({ name: 1 }).lean();
}

async function createPaymentOption({ name, logo }) {
  if (!name || String(name).trim().length === 0) {
    const err = new Error('name is required');
    err.status = 400;
    throw err;
  }
  const exists = await PaymentOption.findOne({ name: String(name).trim() }).lean();
  if (exists) {
    const err = new Error('Payment option already exists');
    err.status = 409;
    throw err;
  }
  const row = await PaymentOption.create({ name: String(name).trim(), logo });
  return { id: String(row._id), name: row.name, logo: row.logo };
}

async function setDriverPaymentPreference(driverId, paymentOptionId) {
  const opt = await PaymentOption.findById(paymentOptionId).lean();
  if (!opt) {
    const err = new Error('Payment option not found');
    err.status = 404;
    throw err;
  }
  const updated = await Driver.findByIdAndUpdate(String(driverId), { $set: { paymentPreference: opt._id } }, { new: true })
    .populate({ path: 'paymentPreference', select: { name: 1, logo: 1 } });
  if (!updated) {
    const err = new Error('Driver not found');
    err.status = 404;
    throw err;
  }
  return updated;
}

module.exports = { getPaymentOptions, setDriverPaymentPreference, createPaymentOption };

