const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/booking.controller');
const { authenticate, authorize } = require('../../middleware/auth');

router.post('/', authenticate, authorize('passenger'), ctrl.create);
router.get('/', authenticate, authorize('passenger','admin','superadmin'), ctrl.list);
// Nearby bookings for drivers
router.get('/nearby', authenticate, authorize('driver','admin','staff','superadmin'), ctrl.nearby);
// Debug endpoint to check authentication
router.get('/debug/auth', authenticate, (req, res) => {
  const { id, type, name, phone, email, wallet, rating, rewardPoints, iat, exp } = req.user || {};
  res.json({ 
    user: { id, type, name, phone, email, wallet, rating, rewardPoints, iat, exp }, 
    userType: type, 
    userId: id,
    timestamp: new Date().toISOString()
  });
});
router.get('/:id', authenticate, authorize('passenger','admin','superadmin'), ctrl.get);
router.put('/:id', authenticate, authorize('passenger'), ctrl.update);
router.delete('/:id', authenticate, authorize('passenger'), ctrl.remove);
// Admin and driver lifecycle and assignment
router.post('/:id/lifecycle', authenticate, authorize('admin','superadmin','driver'), ctrl.lifecycle);
router.post('/:id/assign', authenticate, authorize('admin','superadmin','staff'), ctrl.assign);
// Fare estimation by admin
router.post('/estimate', authenticate, authorize('admin','superadmin'), ctrl.estimate);
// Rating endpoints
router.post('/:id/rate-passenger', authenticate, authorize('driver'), ctrl.ratePassenger);
router.post('/:id/rate-driver', authenticate, authorize('passenger'), ctrl.rateDriver);
// Passenger vehicle types
router.get('/vehicle/types', authenticate, authorize('passenger'), (req, res) => res.json(['mini','sedan','van']));

module.exports = router;
