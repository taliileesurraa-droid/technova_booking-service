const { Pricing } = require('../models/pricing');
const { recalcForBooking } = require('../services/bookingPricingService');
const { crudController } = require('./basic.crud');
const { broadcast } = require('../sockets/utils');
const logger = require('../utils/logger');

const base = crudController(Pricing);

async function updateAndBroadcast(req, res) {
  try {
    const item = await Pricing.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ message: 'Not found' });
    // Include bookingId if present in request body (for clients tracking pricing per booking)
    const payload = { ...item.toObject?.() ? item.toObject() : item, ...(req.body && req.body.bookingId ? { bookingId: String(req.body.bookingId) } : {}) };
    try { logger.info('[events] pricing:update (admin update)', payload); } catch (_) {}
    broadcast('pricing:update', payload);
    return res.json(item);
  } catch (e) { return res.status(500).json({ message: e.message }); }
}

// Override get to allow numeric/string IDs (non-ObjectId)
async function getFlexible(req, res) {
  try {
    const id = req.params.id;
    let item = null;
    if (id && id.match && id.match(/^[0-9a-fA-F]{24}$/)) {
      item = await Pricing.findById(id);
    }
    if (!item) {
      // Fall back: support numeric alias like '1' to mean latest active pricing
      if (String(id) === '1' || String(id).toLowerCase() === 'latest') {
        item = await Pricing.findOne({ isActive: true }).sort({ updatedAt: -1 });
      }
    }
    if (!item) return res.status(404).json({ message: 'Not found' });
    return res.json(item);
  } catch (e) { return res.status(500).json({ message: e.message }); }
}

module.exports = { ...base, get: getFlexible, updateAndBroadcast };

// New: Recalculate pricing for a booking and broadcast update with bookingId
module.exports.recalculateByBooking = async (req, res) => {
  try {
    const { bookingId } = req.body || {};
    if (!bookingId) return res.status(400).json({ message: 'bookingId is required' });
    const payload = await recalcForBooking(bookingId);
    try { logger.info('[events] pricing:update (recalculate)', payload); } catch (_) {}
    broadcast('pricing:update', payload);
    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

