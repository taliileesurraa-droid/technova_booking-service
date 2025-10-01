// Re-export Booking-related models to keep persistence centralized
const { Booking, BookingAssignment, TripHistory, Live } = require('../../models/bookingModels');

module.exports = { Booking, BookingAssignment, TripHistory, Live };

