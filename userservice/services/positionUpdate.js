const { Live } = require('../models/bookingModels');
const { broadcast } = require('../sockets/utils');

class PositionUpdateService {
  constructor() {
    this.intervals = new Map(); // Store intervals for each active trip
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
  }

  stop() {
    if (!this.isRunning) return;
    
    // Clear all intervals
    this.intervals.forEach((interval, tripId) => {
      clearInterval(interval);
    });
    this.intervals.clear();
    
    this.isRunning = false;
    
  }

  // Start tracking position updates for a trip
  startTracking(tripId, driverId, passengerId) {
    if (this.intervals.has(tripId)) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        // Get latest position for driver
        const latestPosition = await Live.findOne({
          driverId,
          locationType: 'current'
        }).sort({ createdAt: -1 });

        if (latestPosition) {
          // Broadcast position update
          broadcast('position:update', {
            tripId,
            driverId,
            passengerId,
            latitude: latestPosition.latitude,
            longitude: latestPosition.longitude,
            bearing: latestPosition.bearing,
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error(`Error updating position for trip ${tripId}:`, error);
      }
    }, 60000); // 60 seconds

    this.intervals.set(tripId, interval);
    
  }

  // Stop tracking position updates for a trip
  stopTracking(tripId) {
    const interval = this.intervals.get(tripId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(tripId);
      
    }
  }

  // Get active trips being tracked
  getActiveTrips() {
    return Array.from(this.intervals.keys());
  }
}

// Singleton instance
const positionUpdateService = new PositionUpdateService();

module.exports = positionUpdateService;
