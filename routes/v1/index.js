const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../../middleware/auth");

router.use("/auth", require("./auth.routes"));
// Public webhooks (no auth) MUST be mounted before authenticate
router.use(
  "/wallet",
  (() => {
    const express = require("express");
    const r = express.Router();
    const ctrl = require("../../controllers/wallet.controller");
    // public webhook only
    r.post("/webhook", ctrl.webhook);
    return r;
  })()
);

// Everything below requires auth
router.use(authenticate);

router.use("/bookings", require("./booking.routes"));
router.use(
  "/assignments",
  authorize("admin", "staff"),
  require("./assignment.routes")
);
router.use("/trips", require("./trip.routes"));
router.use("/live", require("./live.routes"));
router.use("/pricing", authorize("admin"), require("./pricing.routes"));
router.use("/driver-pricing", require("./driverPricing.routes"));
router.use("/admins", authorize("admin"), require("./admin.routes"));
router.use("/drivers", require("./driver.routes"));
// Payment options simple router
router.get('/payment-options', async (req, res) => {
  try {
    const ctrl = require('../../controllers/driver.controller');
    return await ctrl.listPaymentOptions(req, res);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});
router.post('/payment-options', authorize('admin','superadmin'), async (req, res) => {
  try {
    const { create } = require('../../controllers/paymentOption.controller');
    return await create(req, res);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});
router.post('/driver/payment-preference', async (req, res) => {
  try {
    const ctrl = require('../../controllers/driver.controller');
    return await ctrl.setPaymentPreference(req, res);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});
router.use("/mapping", require("./mapping.routes"));
router.use("/passengers", require("./passenger.routes"));
router.use("/analytics", require("./analytics.routes"));
router.use("/wallet", require("./wallet.routes"));

module.exports = router;
