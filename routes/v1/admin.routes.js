const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin.controller');
const { authorize } = require('../../middleware/auth');

router.get('/', authorize('admin','superadmin'), ctrl.list);
router.get('/:id', authorize('admin','superadmin'), ctrl.get);

// Keep create/update/remove for local domain-only if needed
router.post('/', authorize('superadmin'), ctrl.create);
router.put('/:id', authorize('superadmin'), ctrl.update);
router.delete('/:id', authorize('superadmin'), ctrl.remove);

module.exports = router;


