const mongoose = require('mongoose');

const DailyReportSchema = new mongoose.Schema({
  date: { type: Date, required: true, index: true },
  totalRides: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  totalCommission: { type: Number, default: 0 },
  totalDrivers: { type: Number, default: 0 },
  totalPassengers: { type: Number, default: 0 },
  totalCars: { type: Number, default: 0 },
  totalComplaints: { type: Number, default: 0 },
  averageFare: { type: Number, default: 0 },
  completedRides: { type: Number, default: 0 },
  canceledRides: { type: Number, default: 0 },
  rideDetails: [{
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    driverId: { type: String },
    passengerId: { type: String },
    fare: { type: Number },
    commission: { type: Number },
    status: { type: String },
    vehicleType: { type: String },
    distanceKm: { type: Number }
  }]
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

const WeeklyReportSchema = new mongoose.Schema({
  weekStart: { type: Date, required: true, index: true },
  weekEnd: { type: Date, required: true },
  totalRides: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  totalCommission: { type: Number, default: 0 },
  totalDrivers: { type: Number, default: 0 },
  totalPassengers: { type: Number, default: 0 },
  totalCars: { type: Number, default: 0 },
  totalComplaints: { type: Number, default: 0 },
  averageFare: { type: Number, default: 0 },
  completedRides: { type: Number, default: 0 },
  canceledRides: { type: Number, default: 0 },
  dailyBreakdown: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DailyReport' }]
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

const MonthlyReportSchema = new mongoose.Schema({
  month: { type: Number, required: true, index: true }, // 1-12
  year: { type: Number, required: true, index: true },
  totalRides: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  totalCommission: { type: Number, default: 0 },
  totalDrivers: { type: Number, default: 0 },
  totalPassengers: { type: Number, default: 0 },
  totalCars: { type: Number, default: 0 },
  totalComplaints: { type: Number, default: 0 },
  averageFare: { type: Number, default: 0 },
  completedRides: { type: Number, default: 0 },
  canceledRides: { type: Number, default: 0 },
  weeklyBreakdown: [{ type: mongoose.Schema.Types.ObjectId, ref: 'WeeklyReport' }]
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

const ComplaintSchema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
  complainantId: { type: String, required: true }, // Passenger or Driver ID
  complainantType: { type: String, enum: ['passenger', 'driver'], required: true },
  againstId: { type: String, required: true }, // Driver or Passenger ID
  againstType: { type: String, enum: ['passenger', 'driver'], required: true },
  complaintType: { type: String, enum: ['rude_behavior', 'unsafe_driving', 'late_arrival', 'overcharging', 'vehicle_condition', 'other'], required: true },
  description: { type: String, required: true },
  status: { type: String, enum: ['open', 'investigating', 'resolved', 'dismissed'], default: 'open' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  assignedTo: { type: String }, // Admin/Staff ID
  resolution: { type: String },
  resolvedAt: { type: Date },
  resolvedBy: { type: String } // Admin/Staff ID
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

module.exports = {
  DailyReport: mongoose.model('DailyReport', DailyReportSchema),
  WeeklyReport: mongoose.model('WeeklyReport', WeeklyReportSchema),
  MonthlyReport: mongoose.model('MonthlyReport', MonthlyReportSchema),
  Complaint: mongoose.model('Complaint', ComplaintSchema)
};
