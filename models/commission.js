const mongoose = require('mongoose');

const CommissionSchema = new mongoose.Schema({
  driverId: { type: String, required: true, index: true },
  percentage: { type: Number, required: true, min: 0, max: 100 },
  effectiveTo: { type: Date },
  createdBy: { type: String, required: true }, // Admin ID who set this commission
  description: { type: String }
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

const DriverEarningsSchema = new mongoose.Schema({
  driverId: { type: String, required: true, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
  tripDate: { type: Date, required: true, index: true },
  grossFare: { type: Number, required: true },
  commissionAmount: { type: Number, required: true },
  netEarnings: { type: Number, required: true },
  commissionPercentage: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'paid', 'disputed'], default: 'pending' },
  paidAt: { type: Date },
  paymentMethod: { type: String },
  notes: { type: String }
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

const AdminEarningsSchema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
  tripDate: { type: Date, required: true, index: true },
  grossFare: { type: Number, required: true },
  commissionEarned: { type: Number, required: true },
  commissionPercentage: { type: Number, required: true },
  driverId: { type: String, required: true },
  passengerId: { type: String, required: true }
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

const PayoutSchema = new mongoose.Schema({
  driverId: { type: String, required: true, index: true },
  payoutPeriod: { type: String, enum: ['daily', 'weekly', 'monthly'], required: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  totalEarnings: { type: Number, required: true },
  totalCommission: { type: Number, required: true },
  netPayout: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'processing', 'paid', 'failed'], default: 'pending' },
  paidAt: { type: Date },
  paymentMethod: { type: String },
  transactionId: { type: String },
  earnings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DriverEarnings' }]
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

module.exports = {
  Commission: mongoose.model('Commission', CommissionSchema),
  DriverEarnings: mongoose.model('DriverEarnings', DriverEarningsSchema),
  AdminEarnings: mongoose.model('AdminEarnings', AdminEarningsSchema),
  Payout: mongoose.model('Payout', PayoutSchema)
};
