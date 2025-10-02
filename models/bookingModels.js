  // bookingModels.js
  const mongoose = require('mongoose');

  /**
   * Booking Schema
   * Stores booking lifecycle with denormalized passenger/driver IDs.
   */
  const BookingSchema = new mongoose.Schema(
    {
      passengerId: { type: String, required: true, index: true }, // From User Service
      driverId: { type: String, index: true }, // From User Service
      passengerName: { type: String }, // Denormalized (optional)
      passengerPhone: { type: String }, // Denormalized (optional)

      pickup: {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
        address: { type: String },
      },
      dropoff: {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
        address: { type: String },
      },

      vehicleType: {
        type: String,
        enum: ['mini', 'sedan', 'van', 'motorbike', 'bajaj'],
        default: 'mini',
      },
      status: {
        type: String,
        enum: ['requested', 'accepted', 'ongoing', 'completed', 'canceled'],
        default: 'requested',
      },

      // Cancellation metadata
      canceledBy: { type: String, enum: ['driver', 'passenger', 'system'] },
      canceledReason: { type: String },

      // Fare details
      fareEstimated: { type: Number },
      fareFinal: { type: Number },
      fareBreakdown: {
        base: Number,
        distanceCost: Number,
        timeCost: Number,
        waitingCost: Number,
        surgeMultiplier: Number,
        // Enhanced pricing breakdown fields
        surgeFactor: Number,
        timeOfDayMultiplier: Number,
        demandMultiplier: Number,
        driverPremium: Number,
        platformFee: Number,
        taxes: Number,
        perKm: Number,
        perMinute: Number,
        waitingPerMinute: Number,
        minimumFare: Number,
        maximumFare: Number,
        actualDistance: Number,
        actualDuration: Number
      },
      distanceKm: { type: Number },
      
      // Enhanced pricing calculation metadata
      pricingCalculation: {
        calculatedAt: Date,
        source: { type: String, enum: ['system', 'driver', 'admin'], default: 'system' },
        ruleId: String,
        version: Number
      },
      
      // Trip actual values for final pricing
      actualDistanceKm: { type: Number },
      actualDurationMinutes: { type: Number },
      waitingTimeMinutes: { type: Number },

      // Payments
      paymentMethod: { type: String, enum: ['cash','wallet','telebirr','cbe','card','santimpay'] },
      transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },

      // Timestamps for lifecycle
      acceptedAt: { type: Date },
      startedAt: { type: Date },
      completedAt: { type: Date },

      // Ratings
      passengerRating: { type: Number, min: 1, max: 5 },
      passengerComment: { type: String },
      driverRating: { type: Number, min: 1, max: 5 },
      driverComment: { type: String },
    },
    { timestamps: true }
  );

  BookingSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_, ret) => {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  });

  /**
   * TripHistory Schema
   * Logs lifecycle events for a booking.
   */
  const TripHistorySchema = new mongoose.Schema(
    {
      bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true,
      },
      driverId: { type: String }, // From User Service
      passengerId: { type: String }, // From User Service
      status: {
        type: String,
        enum: ['requested', 'accepted', 'ongoing', 'completed', 'canceled'],
        required: true,
      },

      fare: { type: Number },
      distance: { type: Number },
      duration: { type: Number },

      pickupLocation: {
        latitude: Number,
        longitude: Number,
        address: String,
      },
      dropoffLocation: {
        latitude: Number,
        longitude: Number,
        address: String,
      },

      startTime: { type: Date },
      endTime: { type: Date },
      dateOfTravel: { type: Date, default: Date.now },
      notes: { type: String },
    },
    { timestamps: true }
  );

  TripHistorySchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_, ret) => {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  });

  /**
   * Live Location Schema
   * Tracks real-time location updates for trips.
   */
  const LiveSchema = new mongoose.Schema(
    {
      driverId: { type: String, index: true },
      passengerId: { type: String, index: true },

      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },

      status: {
        type: String,
        enum: ['moving', 'stopped', 'offline'],
        default: 'moving',
      },
      tripId: { type: String, index: true }, // Logical trip reference
      locationType: {
        type: String,
        enum: ['pickup', 'dropoff', 'current'],
        default: 'current',
      },

      bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
      timestamp: { type: Date, default: Date.now, index: true },
    },
    { timestamps: true }
  );

  LiveSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_, ret) => {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  });

  /**
   * Booking Assignment Schema
   * Stores dispatcher/driver assignment details for bookings.
   */
  const BookingAssignmentSchema = new mongoose.Schema(
    {
      bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true,
        unique: true,
      },
      driverId: { type: String, required: true, index: true },
      passengerId: { type: String, required: true, index: true }, // denormalized
      dispatcherId: { type: String, index: true },

      priority: {
        type: String,
        enum: ['low', 'normal', 'high', 'urgent'],
        default: 'normal',
      },
      status: {
        type: String,
        enum: ['pending', 'active', 'completed', 'canceled'],
        default: 'active',
      },
      notes: { type: String },
    },
    { timestamps: true }
  );

  BookingAssignmentSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_, ret) => {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  });

  // Export all models
  module.exports = {
    Booking: mongoose.model('Booking', BookingSchema),
    TripHistory: mongoose.model('TripHistory', TripHistorySchema),
    Live: mongoose.model('Live', LiveSchema),
    BookingAssignment: mongoose.model('BookingAssignment', BookingAssignmentSchema),
  };
