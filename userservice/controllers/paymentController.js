const mongoose = require('mongoose');
const {
  createPaymentOption,
  getPaymentOptions,
  getPaymentOptionById,
  updatePaymentOption,
  deletePaymentOption
} = require('../services/paymentService');

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id));
}

function validatePayload(body, { partial = false } = {}) {
  const errors = [];
  const payload = {};

  if (!partial || typeof body.name !== 'undefined') {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      errors.push('name is required and must be a non-empty string');
    } else {
      payload.name = body.name.trim();
    }
  }

  if (typeof body.logo !== 'undefined') {
    if (body.logo === null || body.logo === '') {
      payload.logo = body.logo;
    } else if (typeof body.logo !== 'string') {
      errors.push('logo must be a string URL');
    } else {
      try {
        // Basic URL validation
        // eslint-disable-next-line no-new
        new URL(body.logo);
        payload.logo = body.logo;
      } catch (_) {
        errors.push('logo must be a valid URL');
      }
    }
  }

  return { errors, payload };
}

async function createPaymentOptionController(req, res) {
  try {
    const { errors, payload } = validatePayload(req.body, { partial: false });
    if (errors.length) return res.status(400).json({ message: 'Validation failed', errors });
    const created = await createPaymentOption(payload);
    return res.status(201).json(created);
  } catch (err) {
    const status = err.status || 500;
    const message = err.code === 11000 ? 'Payment option name already exists' : err.message;
    return res.status(status).json({ message });
  }
}

async function listPaymentOptionsController(req, res) {
  try {
    const rows = await getPaymentOptions();
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

async function getPaymentOptionController(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });
    const row = await getPaymentOptionById(id);
    if (!row) return res.status(404).json({ message: 'Payment option not found' });
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

async function updatePaymentOptionController(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });
    const { errors, payload } = validatePayload(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ message: 'Validation failed', errors });
    const updated = await updatePaymentOption(id, payload);
    if (!updated) return res.status(404).json({ message: 'Payment option not found' });
    return res.json(updated);
  } catch (err) {
    const status = err.status || 500;
    const message = err.code === 11000 ? 'Payment option name already exists' : err.message;
    return res.status(status).json({ message });
  }
}

async function deletePaymentOptionController(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });
    const deleted = await deletePaymentOption(id);
    if (!deleted) return res.status(404).json({ message: 'Payment option not found' });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

module.exports = {
  createPaymentOption: createPaymentOptionController,
  listPaymentOptions: listPaymentOptionsController,
  getPaymentOption: getPaymentOptionController,
  updatePaymentOption: updatePaymentOptionController,
  deletePaymentOption: deletePaymentOptionController
};

