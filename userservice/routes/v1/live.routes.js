const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/live.controller');
const { authenticate, authorize } = require('../../middleware/auth');

router.post('/', authenticate, authorize('admin','staff'), ctrl.create);
router.get('/', authenticate, authorize('admin','staff'), ctrl.list);
router.get('/:id', authenticate, authorize('admin','staff'), ctrl.get);
router.put('/:id', authenticate, authorize('admin','staff'), ctrl.update);
router.delete('/:id', authenticate, authorize('admin','staff'), ctrl.remove);
// both driver and passenger can push their live position
router.post('/push', authenticate, authorize('driver','passenger'), ctrl.push);

module.exports = router;

