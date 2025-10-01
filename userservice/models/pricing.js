
const mongoose = require('mongoose');

const ALLOWED_VEHICLE_TYPES = ['mini','sedan','van','suv','mpv','motorbike','bajaj'];

const PricingSchema = new mongoose.Schema({
  vehicleType: {
    type: String,
    enum: ALLOWED_VEHICLE_TYPES,
    required: true,
    index: true
  },
  baseFare: { type: Number, required: true, min: 0 },
  perKm: { type: Number, required: true, min: 0 },
  perMinute: { type: Number, required: true, min: 0 },
  waitingPerMinute: { type: Number, required: true, min: 0 },
  surgeMultiplier: { type: Number, required: true, min: 0 },
  minimumFare: { type: Number, required: true, min: 0 },
  maximumFare: { type: Number, required: true, min: 0 },
  isActive: { type: Boolean, default: true },
  description: { type: String }
}, { timestamps: true });

// Normalize vehicleType, and fix common typo 'motobike'
PricingSchema.pre('validate', function(next) {
  if (this.vehicleType && typeof this.vehicleType === 'string') {
    let v = this.vehicleType.trim().toLowerCase();
    if (v === 'motobike') v = 'motorbike';
    this.vehicleType = v;
  }
  next();
});

PricingSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = { Pricing: mongoose.model('Pricing', PricingSchema), ALLOWED_VEHICLE_TYPES };
