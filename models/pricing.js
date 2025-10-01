const mongoose = require('mongoose');

const PricingSchema = new mongoose.Schema({
  vehicleType: { type: String, enum: ['mini', 'sedan', 'van', 'motorbike', 'bajaj'], default: 'mini', index: true },
  baseFare: { type: Number, default: 2 },
  perKm: { type: Number, default: 1 },
  perMinute: { type: Number, default: 0.2 },
  waitingPerMinute: { type: Number, default: 0.1 },
  surgeMultiplier: { type: Number, default: 1 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = { Pricing: mongoose.model('Pricing', PricingSchema) };

