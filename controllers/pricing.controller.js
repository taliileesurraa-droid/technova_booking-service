const { Pricing } = require('../models/pricing');
const { recalcForBooking } = require('../services/bookingPricingService');
const { crudController } = require('./basic.crud');
const { broadcast } = require('../sockets/utils');

const base = crudController(Pricing);

async function updateAndBroadcast(req, res) {
  try {
    const item = await Pricing.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ message: 'Not found' });
    // Include bookingId if present in request body (for clients tracking pricing per booking)
    const payload = { ...item.toObject?.() ? item.toObject() : item, ...(req.body && req.body.bookingId ? { bookingId: String(req.body.bookingId) } : {}) };
    broadcast('pricing:update', payload);

    // Auto-recalculate pricing for active bookings of this vehicle type and broadcast with location
    try {
      const { Booking } = require('../models/bookingModels');
      const activeBookings = await Booking.find({
        vehicleType: item.vehicleType,
        status: { $in: ['requested', 'accepted', 'ongoing'] }
      }).select({ _id: 1 }).limit(200).lean();
      for (const b of activeBookings) {
        try {
          const p = await recalcForBooking(String(b._id));
          try { logger.info('[events] pricing:update (admin auto-recalc)', p); } catch (_) {}
          broadcast('pricing:update', p);
        } catch (e) { /* continue */ }
      }
    } catch (e) { /* ignore auto-recalc errors */ }
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
    broadcast('pricing:update', payload);
    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

