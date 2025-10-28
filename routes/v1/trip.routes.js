const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/trip.controller');
const { authenticate, authorize } = require('../../middleware/auth');

// Trip history listing:
// - admin/staff: all
// - driver: only their trips
// - passenger: only their trips
router.get('/', authenticate, ctrl.list);
router.get('/:id', authenticate, ctrl.get);
// Remove create/update per requirements
router.delete('/:id', authenticate, authorize('admin','staff'), ctrl.remove);

module.exports = router;

