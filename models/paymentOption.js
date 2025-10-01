const mongoose = require('mongoose');

const PaymentOptionSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  logo: { type: String }
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

module.exports = mongoose.model('PaymentOption', PaymentOptionSchema);

