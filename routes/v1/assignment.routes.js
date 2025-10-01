const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/assignment.controller');
const { authenticate, authorize } = require('../../middleware/auth');

router.post('/', authenticate, authorize('staff','admin'), ctrl.create);
router.get('/', authenticate, authorize('staff','admin'), ctrl.list);
router.get('/:id', authenticate, authorize('staff','admin'), ctrl.get);
router.put('/:id', authenticate, authorize('staff','admin'), ctrl.update);
router.delete('/:id', authenticate, authorize('staff','admin'), ctrl.remove);

module.exports = router;

