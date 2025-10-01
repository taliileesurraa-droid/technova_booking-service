const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth');
const ctrl = require('../../controllers/paymentController');

// All endpoints in this router are behind authenticate (mounted after authenticate in v1 index)

// Create
router.post('/', authorize('admin'), ctrl.createPaymentOption);

// List all (drivers/admin/staff/superadmin)
router.get('/', authorize('driver','admin','staff','superadmin'), ctrl.listPaymentOptions);

// Get one (drivers/admin/staff/superadmin)
router.get('/:id', authorize('driver','admin','staff','superadmin'), ctrl.getPaymentOption);

// Update
router.put('/:id', authorize('admin'), ctrl.updatePaymentOption);

// Delete
router.delete('/:id', authorize('admin'), ctrl.deletePaymentOption);

module.exports = router;

