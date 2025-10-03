const express = require('express');
const router = express.Router();
const driverPricingController = require('../../controllers/driverPricing.controller');
const { authenticate } = require('../../middleware/auth');

/**
 * Driver Pricing Routes
 * Handles pricing estimates, driver pricing management, and pricing calculations
 */

// Public routes (no authentication required)

/**
 * @route POST /v1/driver-pricing/estimate
 * @desc Get pricing estimate for a route
 * @access Public
 * @body {Object} pickup - Pickup location with latitude/longitude
 * @body {Object} dropoff - Dropoff location with latitude/longitude  
 * @body {string} vehicleType - Type of vehicle (mini, sedan, etc.)
 * @body {string} [driverId] - Optional specific driver ID
 */
router.post('/estimate', driverPricingController.getEstimate);

/**
 * @route POST /v1/driver-pricing/estimates/multiple
 * @desc Get pricing estimates for multiple vehicle types
 * @access Public
 * @body {Object} pickup - Pickup location with latitude/longitude
 * @body {Object} dropoff - Dropoff location with latitude/longitude
 * @body {Array} vehicleTypes - Array of vehicle types
 * @body {string} [driverId] - Optional specific driver ID
 */
router.post('/estimates/multiple', driverPricingController.getMultipleEstimates);

/**
 * @route GET /v1/driver-pricing/surge
 * @desc Get current surge information for a location
 * @access Public
 * @query {number} latitude - Location latitude
 * @query {number} longitude - Location longitude
 * @query {string} vehicleType - Vehicle type
 */
router.get('/surge', driverPricingController.getSurgeInfo);

// Protected routes (authentication required)

/**
 * @route POST /v1/driver-pricing/validate
 * @desc Validate pricing configuration
 * @access Private (Admin/Driver)
 * @body {string} vehicleType - Vehicle type
 * @body {Object} pricingRules - Pricing rules to validate
 */
router.post('/validate', authenticate, driverPricingController.validatePricingConfig);

/**
 * @route PUT /v1/driver-pricing/driver/:driverId
 * @desc Update driver-specific pricing rules
 * @access Private (Driver/Admin)
 * @param {string} driverId - Driver ID
 * @body {string} vehicleType - Vehicle type
 * @body {Object} pricingRules - New pricing rules
 */
router.put('/driver/:driverId', authenticate, driverPricingController.updateDriverPricing);

/**
 * @route POST /v1/driver-pricing/recalculate/:bookingId
 * @desc Recalculate pricing for a specific booking
 * @access Private (Admin/Staff)
 * @param {string} bookingId - Booking ID
 * @body {string} [reason] - Reason for recalculation
 */
router.post('/recalculate/:bookingId', authenticate, driverPricingController.recalculateBookingPricing);

/**
 * @route GET /v1/driver-pricing/breakdown/:bookingId
 * @desc Get detailed pricing breakdown for a booking
 * @access Private (Driver/Passenger/Admin)
 * @param {string} bookingId - Booking ID
 */
router.get('/breakdown/:bookingId', authenticate, driverPricingController.getPricingBreakdown);

/**
 * @route POST /v1/driver-pricing/finalize/:bookingId
 * @desc Calculate final pricing for completed trip
 * @access Private (Driver/Admin)
 * @param {string} bookingId - Booking ID
 * @body {Object} tripData - Trip completion data (actual distance, duration, waiting time)
 */
router.post('/finalize/:bookingId', authenticate, driverPricingController.calculateFinalPricing);

/**
 * @route GET /v1/driver-pricing/history/:bookingId
 * @desc Get pricing calculation history for a booking
 * @access Private (Admin/Staff)
 * @param {string} bookingId - Booking ID
 */
router.get('/history/:bookingId', authenticate, driverPricingController.getPricingHistory);

module.exports = router;
