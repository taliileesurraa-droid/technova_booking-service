const { Pricing } = require('../models/pricing');
const { Booking } = require('../models/bookingModels');
const { broadcast } = require('../sockets/utils');
const logger = require('../utils/logger');
const geolib = require('geolib');

// Legacy function - maintained for backward compatibility
async function recalcForBooking(bookingId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }

  const distanceKm = geolib.getDistance(
    { latitude: booking.pickup.latitude, longitude: booking.pickup.longitude },
    { latitude: booking.dropoff.latitude, longitude: booking.dropoff.longitude }
  ) / 1000;

  const p = await Pricing.findOne({ vehicleType: booking.vehicleType, isActive: true }).sort({ updatedAt: -1 });
  if (!p) {
    const err = new Error('Active pricing not found for vehicleType');
    err.status = 404;
    throw err;
  }

  const fareBreakdown = {
    base: p.baseFare,
    distanceCost: distanceKm * p.perKm,
    timeCost: 0,
    waitingCost: 0,
    surgeMultiplier: p.surgeMultiplier,
  };
  const fareEstimated = (fareBreakdown.base + fareBreakdown.distanceCost + fareBreakdown.timeCost + fareBreakdown.waitingCost) * fareBreakdown.surgeMultiplier;

  booking.distanceKm = distanceKm;
  booking.fareEstimated = fareEstimated;
  booking.fareBreakdown = fareBreakdown;
  await booking.save();

  return {
    bookingId: String(booking._id),
    vehicleType: booking.vehicleType,
    pickup: booking.pickup,
    dropoff: booking.dropoff,
    distanceKm,
    fareEstimated,
    fareBreakdown
  };
}

/**
 * Calculate live pricing based on driver's current location during ongoing trip
 * @param {string} bookingId - The booking ID
 * @param {Object} currentLocation - Driver's current location {latitude, longitude}
 * @returns {Object} Updated pricing calculation
 */
async function calculateLivePricing(bookingId, currentLocation) {
  try {
    logger.info('[PricingService] Starting live pricing calculation:', {
      bookingId,
      currentLocation,
      timestamp: new Date().toISOString()
    });

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      logger.error('[PricingService] Booking not found:', { bookingId });
      throw new Error('Booking not found');
    }

    logger.info('[PricingService] Booking found:', {
      bookingId,
      status: booking.status,
      vehicleType: booking.vehicleType,
      driverId: booking.driverId,
      pickup: booking.pickup
    });

    if (booking.status !== 'ongoing') {
      // Allow live pricing during accepted status as a preview until trip_started flips to ongoing
      if (booking.status !== 'accepted') {
        logger.warn('[PricingService] Invalid booking status for pricing update:', {
          bookingId,
          currentStatus: booking.status,
          requiredStatus: 'ongoing|accepted'
        });
        throw new Error('Pricing updates only available for ongoing or accepted trips');
      }
    }

    // Get admin-set pricing for vehicle type
    logger.info('[PricingService] Looking up pricing for vehicle type:', {
      bookingId,
      vehicleType: booking.vehicleType
    });

    const pricing = await Pricing.findOne({ 
      vehicleType: booking.vehicleType, 
      isActive: true 
    }).sort({ updatedAt: -1 });

    if (!pricing) {
      logger.error('[PricingService] No active pricing found:', {
        bookingId,
        vehicleType: booking.vehicleType
      });
      throw new Error(`No active pricing found for vehicle type: ${booking.vehicleType}`);
    }

    logger.info('[PricingService] Pricing rules found:', {
      bookingId,
      pricingId: pricing._id,
      baseFare: pricing.baseFare,
      perKm: pricing.perKm,
      minimumFare: pricing.minimumFare,
      surgeMultiplier: pricing.surgeMultiplier
    });

    // Calculate distance from pickup to current location
    logger.info('[PricingService] Calculating distance:', {
      bookingId,
      pickup: booking.pickup,
      currentLocation
    });

    const distanceTraveled = geolib.getDistance(
      { latitude: booking.pickup.latitude, longitude: booking.pickup.longitude },
      { latitude: currentLocation.latitude, longitude: currentLocation.longitude }
    ) / 1000; // Convert to kilometers

    logger.info('[PricingService] Distance calculated:', {
      bookingId,
      distanceTraveled: Math.round(distanceTraveled * 100) / 100
    });

    // Calculate live fare based on distance traveled
    const fareBreakdown = {
      base: pricing.baseFare,
      distanceCost: distanceTraveled * pricing.perKm,
      timeCost: 0, // Can be enhanced with trip duration
      waitingCost: 0,
      surgeMultiplier: pricing.surgeMultiplier || 1,
    };

    const currentFare = (fareBreakdown.base + fareBreakdown.distanceCost + fareBreakdown.timeCost + fareBreakdown.waitingCost) * fareBreakdown.surgeMultiplier;

    // Apply minimum fare constraint
    const finalFare = Math.max(currentFare, pricing.minimumFare || 0);

    logger.info('[PricingService] Fare calculation completed:', {
      bookingId,
      fareBreakdown: {
        base: fareBreakdown.base,
        distanceCost: Math.round(fareBreakdown.distanceCost * 100) / 100,
        surgeMultiplier: fareBreakdown.surgeMultiplier
      },
      currentFare: Math.round(currentFare * 100) / 100,
      finalFare: Math.round(finalFare * 100) / 100,
      minimumFareApplied: finalFare > currentFare
    });

    const result = {
      bookingId: String(booking._id),
      currentLocation,
      distanceTraveled: Math.round(distanceTraveled * 100) / 100, // Round to 2 decimal places
      currentFare: Math.round(finalFare * 100) / 100,
      fareBreakdown: {
        ...fareBreakdown,
        distanceCost: Math.round(fareBreakdown.distanceCost * 100) / 100
      },
      updatedAt: new Date()
    };

    // Broadcast pricing update to driver
    logger.info('[PricingService] Broadcasting pricing update:', {
      bookingId,
      broadcastChannels: [`pricing:update:${bookingId}`, 'pricing:update'],
      result: {
        distanceTraveled: result.distanceTraveled,
        currentFare: result.currentFare,
        updatedAt: result.updatedAt
      }
    });

    broadcast(`pricing:update:${bookingId}`, result);
    broadcast('pricing:update', result);

    logger.info('[PricingService] Live pricing calculation completed successfully:', {
      bookingId: String(booking._id),
      driverId: booking.driverId,
      distanceTraveled: result.distanceTraveled,
      currentFare: result.currentFare,
      processingTimeMs: Date.now() - new Date(result.updatedAt).getTime()
    });

    return result;
  } catch (error) {
    logger.error('[PricingService] Error calculating live pricing:', {
      bookingId,
      currentLocation,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

module.exports = { 
  recalcForBooking,
  calculateLivePricing
};

