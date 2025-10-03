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

async function setDriverPaymentPreference(driverId, paymentOptionId, options = {}) {
  const logger = require('../utils/logger');
  const opt = await PaymentOption.findById(paymentOptionId).lean();
  if (!opt) {
    const err = new Error('Payment option not found');
    try { logger.warn('[payment] payment option not found', { paymentOptionId }); } catch (_) {}
    err.status = 404;
    throw err;
  }

  // Try update by internal id - add to paymentPreferences array if not already present
  let updated = await Driver.findByIdAndUpdate(
    String(driverId), 
    { $addToSet: { paymentPreferences: opt._id } }, 
    { new: true }
  ).populate({ path: 'paymentPreferences', select: { name: 1, logo: 1 } });

  // Fallback: by externalId if internal id did not match
  if (!updated) {
    try { logger.info('[payment] driver not found by _id, trying externalId', { driverId }); } catch (_) {}
    const existingByExternal = await Driver.findOne({ externalId: String(driverId) }).select({ _id: 1 }).lean();
    if (existingByExternal && existingByExternal._id) {
      updated = await Driver.findByIdAndUpdate(
        String(existingByExternal._id), 
        { $addToSet: { paymentPreferences: opt._id } }, 
        { new: true }
      ).populate({ path: 'paymentPreferences', select: { name: 1, logo: 1 } });
    }
  }

  // Final fallback: upsert from external user-service and retry
  if (!updated) {
    try {
      const { getDriverById } = require('../integrations/userServiceClient');
      const authHeader = options && options.headers ? options.headers.Authorization : undefined;
      try { logger.info('[payment] fetching driver from user-service', { driverId, hasAuth: !!authHeader }); } catch (_) {}
      const ext = await getDriverById(String(driverId), { headers: authHeader ? { Authorization: authHeader } : {} });
      if (ext && ext.id) {
        // Create or update the local driver record using external details
        const payload = {
          _id: String(ext.id),
          externalId: String(ext.id),
          name: ext.name,
          phone: ext.phone,
          email: ext.email,
          vehicleType: ext.vehicleType,
          lastKnownLocation: ext.lastKnownLocation,
          rating: Number.isFinite(ext.rating) ? ext.rating : 5.0
        };
        try { logger.info('[payment] upserting driver from user-service', { _id: payload._id, hasPhone: !!payload.phone }); } catch (_) {}
        await Driver.updateOne({ _id: String(ext.id) }, { $set: payload }, { upsert: true });
        updated = await Driver.findByIdAndUpdate(
          String(ext.id), 
          { $addToSet: { paymentPreferences: opt._id } }, 
          { new: true }
        ).populate({ path: 'paymentPreferences', select: { name: 1, logo: 1 } });
      } else {
        try { logger.warn('[payment] user-service did not return driver', { driverId }); } catch (_) {}
      }
    } catch (e) {
      try { logger.error('[payment] user-service fetch failure', e); } catch (_) {}
    }
  }

  // Absolute last resort: upsert minimal local record AND set preference atomically
  if (!updated) {
    const minimalId = String(driverId);
    try { logger.warn('[payment] creating minimal local driver record', { driverId: minimalId }); } catch (_) {}
    updated = await Driver.findOneAndUpdate(
      { _id: minimalId },
      { 
        $setOnInsert: { _id: minimalId, externalId: minimalId, rating: 5.0 },
        $addToSet: { paymentPreferences: opt._id }
      },
      { new: true, upsert: true }
    ).populate({ path: 'paymentPreferences', select: { name: 1, logo: 1 } });
  }

  if (!updated) {
    const err = new Error('Driver not found');
    try { logger.error('[payment] failed to set payment preference for driver', { driverId, paymentOptionId }); } catch (_) {}
    err.status = 404;
    throw err;
  }
  return updated;
}

async function removeDriverPaymentPreference(driverId, paymentOptionId, options = {}) {
  const logger = require('../utils/logger');
  const opt = await PaymentOption.findById(paymentOptionId).lean();
  if (!opt) {
    const err = new Error('Payment option not found');
    try { logger.warn('[payment] payment option not found', { paymentOptionId }); } catch (_) {}
    err.status = 404;
    throw err;
  }

  // Try update by internal id - remove from paymentPreferences array
  let updated = await Driver.findByIdAndUpdate(
    String(driverId), 
    { $pull: { paymentPreferences: opt._id } }, 
    { new: true }
  ).populate({ path: 'paymentPreferences', select: { name: 1, logo: 1 } });

  // Fallback: by externalId if internal id did not match
  if (!updated) {
    try { logger.info('[payment] driver not found by _id, trying externalId', { driverId }); } catch (_) {}
    const existingByExternal = await Driver.findOne({ externalId: String(driverId) }).select({ _id: 1 }).lean();
    if (existingByExternal && existingByExternal._id) {
      updated = await Driver.findByIdAndUpdate(
        String(existingByExternal._id), 
        { $pull: { paymentPreferences: opt._id } }, 
        { new: true }
      ).populate({ path: 'paymentPreferences', select: { name: 1, logo: 1 } });
    }
  }

  if (!updated) {
    const err = new Error('Driver not found');
    try { logger.error('[payment] failed to remove payment preference for driver', { driverId, paymentOptionId }); } catch (_) {}
    err.status = 404;
    throw err;
  }
  return updated;
}

module.exports = { getPaymentOptions, setDriverPaymentPreference, removeDriverPaymentPreference, createPaymentOption };

