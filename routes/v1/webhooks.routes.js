const express = require('express');
const router = express.Router();

const logger = require('../../utils/logger');

// Public webhook echo endpoint
router.post('/public', (req, res) => {
  return res.json({
    ok: true,
    receivedAt: new Date().toISOString(),
    method: req.method,
    path: req.path,
    headers: req.headers,
    query: req.query,
    body: req.body,
    user: req.user,
    token: req.token,
    tokenPayload: req.tokenPayload,
    tokenSignature: req.tokenSignature,
    amount: req.amount,
    currency: req.currency,
    paymentMethod: req.paymentMethod,
    status: req.status,
    message: req.message,
    referenceId: req.referenceId,
    thirdPartyId: req.thirdPartyId
  });
});

// Optional GET for simple verification
router.get('/public', (req, res) => {
  return res.json({
    ok: true,
    receivedAt: new Date().toISOString(),
    method: req.method,
    path: req.path,
    user: req.user,
    token: req.token,
    tokenPayload: req.tokenPayload,
    tokenSignature: req.tokenSignature,
    amount: req.amount,
    currency: req.currency,
    paymentMethod: req.paymentMethod,
    status: req.status,
    message: req.message,
    referenceId: req.referenceId,
    thirdPartyId: req.thirdPartyId
  });
});

// Payment provider webhook (e.g., Telebirr)
router.post('/payment', async (req, res) => {
  try {
    const body = req.body || {};
    // Extract and normalize fields
    const simplified = {
      transactionId: body.txnId || body.transactionId,
      merchantId: body.merId,
      merchantName: body.merName,
      amount: body.totalAmount != null ? Number(body.totalAmount) : (body.amount != null ? Number(body.amount) : undefined),
      currency: body.currency,
      customerPhone: body.msisdn,
      paymentMethod: body.paymentVia,
      status: body.Status || body.status,
      message: body.message,
      referenceId: body.refId || body.referenceId,
      thirdPartyId: body.thirdPartyId
    };

    // Basic validation
    if (!simplified.transactionId) {
      return res.status(400).json({ message: 'Missing transactionId' });
    }

    // TODO: optional signature validation here if provider sends it

    // Persist/update transaction status (pseudo-implementation)
    try {
      const { Transaction } = require('../../models/transaction');
      if (Transaction) {
        await Transaction.findOneAndUpdate(
          { transactionId: String(simplified.transactionId) },
          { $set: { ...simplified, updatedAt: new Date() } },
          { upsert: true, new: true }
        );
      }
    } catch (_) { /* Transaction model may not exist; skip */ }

    // Trigger notifications (pseudo-implementation)
    try {
      const notifier = require('../../services/notifier');
      if (notifier && typeof notifier.notifyPaymentUpdate === 'function') {
        await notifier.notifyPaymentUpdate(simplified);
      }
    } catch (_) { /* optional */ }

    // Log event for audit
    logger.info('[webhook:payment] Simplified payload:', simplified);

    return res.status(200).json({ ok: true });
  } catch (e) {
    logger.error('[webhook:payment] Error:', e);
    return res.status(500).json({ message: 'Webhook processing failed' });
  }
});

module.exports = router;
