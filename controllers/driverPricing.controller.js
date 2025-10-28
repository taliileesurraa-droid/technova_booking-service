const { bookingPricingService, getPricingEstimate } = require('../services/bookingPricingService');
const { broadcast } = require('../sockets/utils');
const logger = require('../utils/logger');

/**
 * Driver Pricing Controller
 * Handles driver-specific pricing management and estimates
 */

/**
 * Get pricing estimate for a route
 * Used by passengers to get fare estimates
 */
async function getEstimate(req, res) {
  try {
    const { pickup, dropoff, vehicleType, driverId } = req.body;

    if (!pickup || !dropoff || !vehicleType) {
      return res.status(400).json({
        message: 'pickup, dropoff, and vehicleType are required'
      });
    }

    if (!pickup.latitude || !pickup.longitude || !dropoff.latitude || !dropoff.longitude) {
      return res.status(400).json({
        message: 'pickup and dropoff must include latitude and longitude'
      });
    }

    const estimate = await getPricingEstimate(pickup, dropoff, vehicleType, driverId);

    return res.json({
      success: true,
      data: estimate
    });
  } catch (error) {
    logger.error('[DriverPricingController] Error getting estimate:', error);
    return res.status(500).json({
      message: 'Failed to calculate pricing estimate',
      error: error.message
    });
  }
}

/**
 * Get multiple estimates for different vehicle types
 */
async function getMultipleEstimates(req, res) {
  try {
    const { pickup, dropoff, vehicleTypes, driverId } = req.body;

    if (!pickup || !dropoff || !vehicleTypes || !Array.isArray(vehicleTypes)) {
      return res.status(400).json({
        message: 'pickup, dropoff, and vehicleTypes array are required'
      });
    }

    const estimates = {};
    
    for (const vehicleType of vehicleTypes) {
      try {
        const estimate = await getPricingEstimate(pickup, dropoff, vehicleType, driverId);
        estimates[vehicleType] = estimate;
      } catch (error) {
        logger.warn(`[DriverPricingController] Failed to get estimate for ${vehicleType}:`, error.message);
        estimates[vehicleType] = {
          error: error.message,
          estimatedFare: null
        };
      }
    }

    return res.json({
      success: true,
      data: {
        pickup,
        dropoff,
        estimates,
        calculatedAt: new Date()
      }
    });
  } catch (error) {
    logger.error('[DriverPricingController] Error getting multiple estimates:', error);
    return res.status(500).json({
      message: 'Failed to calculate pricing estimates',
      error: error.message
    });
  }
}

/**
 * Recalculate pricing for a specific booking
 * Used by admins or drivers to trigger pricing recalculation
 */
async function recalculateBookingPricing(req, res) {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        message: 'bookingId is required'
      });
    }

    const pricingData = await bookingPricingService.recalculateBookingPricing(
      bookingId, 
      reason || 'manual_admin'
    );

    return res.json({
      success: true,
      data: pricingData,
      message: 'Pricing recalculated successfully'
    });
  } catch (error) {
    logger.error('[DriverPricingController] Error recalculating pricing:', error);
    return res.status(500).json({
      message: 'Failed to recalculate pricing',
      error: error.message
    });
  }
}

/**
 * Get comprehensive pricing breakdown for a booking
 */
async function getPricingBreakdown(req, res) {
  try {
    const { bookingId } = req.params;

    if (!bookingId) {
      return res.status(400).json({
        message: 'bookingId is required'
      });
    }

    // This would typically fetch from database
    // For now, we'll return a placeholder response
    const breakdown = {
      bookingId,
      message: 'Pricing breakdown would be retrieved from booking record',
      // In a real implementation, this would fetch the actual booking
      // and return its fareBreakdown and pricingCalculation fields
    };

    return res.json({
      success: true,
      data: breakdown
    });
  } catch (error) {
    logger.error('[DriverPricingController] Error getting pricing breakdown:', error);
    return res.status(500).json({
      message: 'Failed to get pricing breakdown',
      error: error.message
    });
  }
}

/**
 * Trigger driver pricing update event
 * Used when driver updates their pricing preferences
 */
async function updateDriverPricing(req, res) {
  try {
    const { driverId } = req.params;
    const { vehicleType, pricingRules } = req.body;

    if (!driverId || !vehicleType) {
      return res.status(400).json({
        message: 'driverId and vehicleType are required'
      });
    }

    // Emit driver pricing update event
    bookingPricingService.emit('driver:pricing:updated', {
      driverId,
      vehicleType,
      pricingRules,
      updatedAt: new Date()
    });

    // Broadcast to relevant sockets
    broadcast('driver:pricing:updated', {
      driverId,
      vehicleType,
      message: 'Driver pricing rules updated'
    });

    logger.info('[DriverPricingController] Driver pricing updated:', { driverId, vehicleType });

    return res.json({
      success: true,
      message: 'Driver pricing updated successfully',
      data: {
        driverId,
        vehicleType,
        updatedAt: new Date()
      }
    });
  } catch (error) {
    logger.error('[DriverPricingController] Error updating driver pricing:', error);
    return res.status(500).json({
      message: 'Failed to update driver pricing',
      error: error.message
    });
  }
}

/**
 * Get current surge multiplier for a location
 */
async function getSurgeInfo(req, res) {
  try {
    const { latitude, longitude, vehicleType } = req.query;

    if (!latitude || !longitude || !vehicleType) {
      return res.status(400).json({
        message: 'latitude, longitude, and vehicleType are required'
      });
    }

    const location = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude)
    };

    const surgeMultiplier = await bookingPricingService.calculateSurgeMultiplier(location, vehicleType);

    return res.json({
      success: true,
      data: {
        location,
        vehicleType,
        surgeMultiplier,
        surgeLevel: surgeMultiplier > 1.5 ? 'high' : surgeMultiplier > 1.2 ? 'medium' : 'normal',
        calculatedAt: new Date()
      }
    });
  } catch (error) {
    logger.error('[DriverPricingController] Error getting surge info:', error);
    return res.status(500).json({
      message: 'Failed to get surge information',
      error: error.message
    });
  }
}

/**
 * Calculate final pricing for completed trip
 */
async function calculateFinalPricing(req, res) {
  try {
    const { bookingId } = req.params;
    const tripData = req.body;

    if (!bookingId) {
      return res.status(400).json({
        message: 'bookingId is required'
      });
    }

    const finalPricing = await bookingPricingService.calculateFinalPricing(bookingId, tripData);

    return res.json({
      success: true,
      data: finalPricing,
      message: 'Final pricing calculated successfully'
    });
  } catch (error) {
    logger.error('[DriverPricingController] Error calculating final pricing:', error);
    return res.status(500).json({
      message: 'Failed to calculate final pricing',
      error: error.message
    });
  }
}

/**
 * Get pricing history for a booking
 */
async function getPricingHistory(req, res) {
  try {
    const { bookingId } = req.params;

    if (!bookingId) {
      return res.status(400).json({
        message: 'bookingId is required'
      });
    }

    // Placeholder for pricing history retrieval
    // In a real implementation, this would query the BookingPricingHistory collection
    const history = {
      bookingId,
      message: 'Pricing history would be retrieved from BookingPricingHistory collection',
      // This would include all pricing calculations for the booking
    };

    return res.json({
      success: true,
      data: history
    });
  } catch (error) {
    logger.error('[DriverPricingController] Error getting pricing history:', error);
    return res.status(500).json({
      message: 'Failed to get pricing history',
      error: error.message
    });
  }
}

/**
 * Validate pricing configuration
 */
async function validatePricingConfig(req, res) {
  try {
    const { vehicleType, pricingRules } = req.body;

    if (!vehicleType || !pricingRules) {
      return res.status(400).json({
        message: 'vehicleType and pricingRules are required'
      });
    }

    // Validate pricing rules structure
    const requiredFields = ['baseFare', 'perKm', 'perMinute', 'minimumFare'];
    const missingFields = requiredFields.filter(field => 
      pricingRules[field] === undefined || pricingRules[field] === null
    );

    if (missingFields.length > 0) {
      return res.status(400).json({
        message: 'Missing required pricing fields',
        missingFields
      });
    }

    // Validate numeric values
    const numericFields = ['baseFare', 'perKm', 'perMinute', 'minimumFare', 'maximumFare'];
    const invalidFields = numericFields.filter(field => 
      pricingRules[field] !== undefined && 
      (isNaN(pricingRules[field]) || pricingRules[field] < 0)
    );

    if (invalidFields.length > 0) {
      return res.status(400).json({
        message: 'Invalid numeric values in pricing rules',
        invalidFields
      });
    }

    return res.json({
      success: true,
      message: 'Pricing configuration is valid',
      data: {
        vehicleType,
        pricingRules,
        validatedAt: new Date()
      }
    });
  } catch (error) {
    logger.error('[DriverPricingController] Error validating pricing config:', error);
    return res.status(500).json({
      message: 'Failed to validate pricing configuration',
      error: error.message
    });
  }
}

module.exports = {
  getEstimate,
  getMultipleEstimates,
  recalculateBookingPricing,
  getPricingBreakdown,
  updateDriverPricing,
  getSurgeInfo,
  calculateFinalPricing,
  getPricingHistory,
  validatePricingConfig
};
