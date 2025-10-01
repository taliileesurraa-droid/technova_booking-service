// Wrapper to reuse existing TripHistory if available in bookingModels
try {
  const { TripHistory } = require('./bookingModels');
  module.exports = TripHistory;
} catch (e) {
  const mongoose = require('mongoose');
  const tripHistorySchema = new mongoose.Schema({
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
    passengerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Passenger' },
    locations: [{ lat: Number, lng: Number, timestamp: Date }],
    fare: Number,
    distance: Number,
    waitingTime: Number,
    vehicleType: String,
    startedAt: Date,
    completedAt: Date
  }, { timestamps: true });
  module.exports = mongoose.model('TripHistory', tripHistorySchema);
}

