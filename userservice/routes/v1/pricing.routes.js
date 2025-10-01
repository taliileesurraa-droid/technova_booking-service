const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/pricing.controller');
const { authenticate, authorize } = require('../../middleware/auth');

router.post('/', authenticate, authorize('admin'), ctrl.create);
router.get('/', authenticate, authorize('admin'), ctrl.list);
router.get('/:id', authenticate, authorize('admin'), ctrl.get);
router.put('/:id', authenticate, authorize('admin'), ctrl.updateAndBroadcast);
// New: recalc pricing for a booking and broadcast pricing:update with bookingId
router.post('/recalculate', authenticate, authorize('admin'), ctrl.recalculateByBooking);
router.delete('/:id', authenticate, authorize('admin'), ctrl.remove);

module.exports = router;

