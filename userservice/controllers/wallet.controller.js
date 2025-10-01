const { Wallet, Transaction } = require("../models/common");
const santim = require("../integrations/santimpay");
const mongoose = require("mongoose");

exports.topup = async (req, res) => {
  try {
    const { amount, paymentMethod, reason = "Wallet Topup" } = req.body || {};
    if (!amount || amount <= 0)
      return res.status(400).json({ message: "amount must be > 0" });

    // Phone must come from token
    const tokenPhone =
      req.user && (req.user.phone || req.user.phoneNumber || req.user.mobile);
    if (!tokenPhone)
      return res.status(400).json({ message: "phoneNumber missing in token" });

    // Normalize Ethiopian MSISDN
    const normalizeMsisdnEt = (raw) => {
      if (!raw) return null;
      let s = String(raw).trim();
      s = s.replace(/\s+/g, "").replace(/[-()]/g, "");
      if (/^\+?251/.test(s)) {
        s = s.replace(/^\+?251/, "+251");
      } else if (/^0\d+/.test(s)) {
        s = s.replace(/^0/, "+251");
      } else if (/^9\d{8}$/.test(s)) {
        s = "+251" + s;
      }
      if (!/^\+2519\d{8}$/.test(s)) return null;
      return s;
    };

    const msisdn = normalizeMsisdnEt(tokenPhone);
    if (!msisdn)
      return res.status(400).json({
        message: "Invalid phone format in token. Required: +2519XXXXXXXX",
      });

    const userId = String(req.user.id);
    const role = req.user.type;

    let wallet = await Wallet.findOne({ userId, role });
    if (!wallet) wallet = await Wallet.create({ userId, role, balance: 0 });

    // Generate ObjectId manually so we can use it for txnId/refId
    const txId = new mongoose.Types.ObjectId();

    const tx = await Transaction.create({
      _id: txId,
      refId: txId.toString(),
      userId,
      role,
      amount,
      type: "credit",
      method: "santimpay",
      status: "pending",
      msisdn: msisdn,
      metadata: { reason },
    });

    // Resolve payment method from explicit param or driver's selected PaymentOption
    async function resolvePaymentMethod() {
      const pick = (v) => (typeof v === 'string' && v.trim().length) ? v.trim() : null;
      const explicit = pick(paymentMethod);
      if (explicit) return explicit;
      try {
        const { Driver } = require("../models/userModels");
        const me = await Driver.findById(String(userId)).select({ paymentPreference: 1 }).populate({ path: 'paymentPreference', select: { name: 1 } });
        const name = me && me.paymentPreference && me.paymentPreference.name ? String(me.paymentPreference.name).trim() : null;
        if (name) return name;
      } catch (_) {}
      const err = new Error('paymentMethod is required and no driver payment preference is set');
      err.status = 400;
      throw err;
    }
    // Normalize for SantimPay API accepted values
    const normalizePaymentMethod = (method) => {
      const m = String(method || "").trim().toLowerCase();
      if (m === "telebirr" || m === "tele") return "Telebirr";
      if (m === "cbe" || m === "cbe-birr" || m === "cbebirr") return "CBE";
      if (m === "hellocash" || m === "hello-cash") return "HelloCash";
      return method; // pass-through for other configured options
    };

    const methodForGateway = normalizePaymentMethod(await resolvePaymentMethod());

    const notifyUrl =
      process.env.SANTIMPAY_NOTIFY_URL ||
      `${process.env.PUBLIC_BASE_URL || ""}/v1/wallet/webhook`;
    const gw = await santim.directPayment({
      id: txId.toString(),
      amount,
      paymentReason: reason,
      notifyUrl,
      phoneNumber: msisdn,
      paymentMethod: methodForGateway,
    });

    // Persist gateway response keys if present
    const gwTxnId =
      gw?.TxnId || gw?.txnId || gw?.data?.TxnId || gw?.data?.txnId;
    await Transaction.findByIdAndUpdate(txId, {
      txnId: gwTxnId || undefined,
      metadata: { ...tx.metadata, gatewayResponse: gw },
    });

    return res.status(202).json({
      message: "Topup initiated",
      transactionId: txId.toString(),
      gatewayTxnId: gwTxnId,
    });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

exports.webhook = async (req, res) => {
  try {
    // Expect SantimPay to call with fields including txnId, Status, amount, reason, msisdn, refId, thirdPartyId
    const body = req.body || {};
    const data = body.data || body;
    // Debug log (can be toggled off via env)
    if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.log("[wallet-webhook] received:", data);
    }
    // Prefer the id we originally sent (provider echoes it as thirdPartyId). Do not use provider RefId as our id.
    const thirdPartyId =
      data.thirdPartyId ||
      data.ID ||
      data.id ||
      data.transactionId ||
      data.clientReference;
    const providerRefId = data.RefId || data.refId;
    const gwTxnId = data.TxnId || data.txnId;
    if (!thirdPartyId && !gwTxnId)
      return res.status(400).json({ message: "Invalid webhook payload" });

    let tx = null;
    // If thirdPartyId looks like an ObjectId, try findById
    if (thirdPartyId && mongoose.Types.ObjectId.isValid(String(thirdPartyId))) {
      tx = await Transaction.findById(thirdPartyId);
    }
    // Otherwise try our refId match (we set refId to our ObjectId string when creating the tx)
    if (!tx && thirdPartyId) {
      tx = await Transaction.findOne({ refId: String(thirdPartyId) });
    }
    // Fallback to gateway txnId
    if (!tx && gwTxnId) {
      tx = await Transaction.findOne({ txnId: String(gwTxnId) });
    }
    if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.log("[wallet-webhook] match:", {
        thirdPartyId,
        gwTxnId,
        providerRefId,
        found: !!tx,
        txId: tx ? String(tx._id) : null,
        statusBefore: tx ? tx.status : null,
      });
    }
    if (!tx) {
      // Always ACK to avoid provider retries, but indicate not found
      return res.status(200).json({
        ok: false,
        message: "Transaction not found for webhook",
        thirdPartyId,
        txnId: gwTxnId,
        providerRefId,
      });
    }

    const rawStatus = (data.Status || data.status || "")
      .toString()
      .toUpperCase();
    const normalizedStatus = ["COMPLETED", "SUCCESS", "APPROVED"].includes(
      rawStatus
    )
      ? "success"
      : ["FAILED", "CANCELLED", "DECLINED"].includes(rawStatus)
      ? "failed"
      : "pending";

    const previousStatus = tx.status;
    tx.txnId = gwTxnId || tx.txnId;
    // Keep our refId as initially set (our ObjectId), do not overwrite with provider's RefId
    tx.refId = tx.refId || (thirdPartyId && String(thirdPartyId));
    tx.status = normalizedStatus;
    // Numeric fields from provider
    const n = (v) => (v == null ? undefined : Number(v));
    tx.commission = n(data.commission) ?? n(data.Commission) ?? tx.commission;
    tx.totalAmount =
      n(data.totalAmount) ?? n(data.TotalAmount) ?? tx.totalAmount;
    tx.msisdn = data.Msisdn || data.msisdn || tx.msisdn;
    tx.metadata = {
      ...tx.metadata,
      webhook: data,
      raw: body,
      created_at: data.created_at,
      updated_at: data.updated_at,
      merId: data.merId,
      merName: data.merName,
      paymentVia: data.paymentVia || data.PaymentMethod,
      commissionAmountInPercent: data.commissionAmountInPercent,
      providerCommissionAmountInPercent: data.providerCommissionAmountInPercent,
      vatAmountInPercent: data.vatAmountInPercent || data.VatAmountInPercent,
      lotteryTax: data.lotteryTax,
      reason: data.reason,
    };
    tx.updatedAt = new Date();

    // Idempotency: if already final state, do not re-apply wallet mutation
    const wasFinal =
      previousStatus === "success" || previousStatus === "failed";
    await tx.save();
    if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.log("[wallet-webhook] updated tx:", {
        txId: String(tx._id),
        statusAfter: tx.status,
      });
    }

    if (!wasFinal && normalizedStatus === "success") {
      // For credits, prefer adjustedAmount (intended topup) then amount; for debits, prefer amount then adjustedAmount
      const providerAmount =
        tx.type === "credit"
          ? n(data.adjustedAmount) ?? n(data.amount) ?? tx.amount
          : n(data.amount) ?? n(data.adjustedAmount) ?? tx.amount;
      if (tx.type === "credit") {
        // If this is a provider deposit for drivers, convert to package using dynamic commissionRate
        let delta = providerAmount;
        try {
          const { Commission } = require("../models/commission");
          const financeService = require("../services/financeService");
          let commissionRate = Number(process.env.COMMISSION_RATE || 15);
          try {
            if (tx && tx.role === 'driver' && tx.userId) {
              const commissionDoc = await Commission.findOne({ driverId: String(tx.userId) }).sort({ createdAt: -1 });
              if (commissionDoc && Number.isFinite(commissionDoc.percentage)) {
                commissionRate = commissionDoc.percentage;
              }
            }
          } catch (_) {}
          if (tx.role === 'driver') {
            delta = financeService.calculatePackage(providerAmount, commissionRate);
          }
        } catch (_) {}
        await Wallet.updateOne(
          { userId: tx.userId, role: tx.role },
          { $inc: { balance: delta } },
          { upsert: true }
        );
      } else if (tx.type === "debit") {
        await Wallet.updateOne(
          { userId: tx.userId, role: tx.role },
          { $inc: { balance: -providerAmount } },
          { upsert: true }
        );
      }
      if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
        // eslint-disable-next-line no-console
        console.log("[wallet-webhook] wallet mutated:", {
          userId: tx.userId,
          role: tx.role,
          type: tx.type,
          delta: tx.type === "credit" ? providerAmount : -providerAmount,
        });
      }
    }

    // Respond with concise, important fields only
    return res.status(200).json({
      ok: true,
      txnId: data.TxnId || data.txnId,
      refId: data.RefId || data.refId,
      thirdPartyId: data.thirdPartyId,
      status: data.Status || data.status,
      statusReason: data.StatusReason || data.message,
      amount: data.amount || data.Amount || data.TotalAmount,
      currency: data.currency || data.Currency || "ETB",
      msisdn: data.Msisdn || data.msisdn,
      paymentVia: data.paymentVia || data.PaymentMethod,
      message: data.message,
      updateType: data.updateType || data.UpdateType,
      updatedAt: new Date(),
      updatedBy: data.updatedBy || data.UpdatedBy,
    });
  } catch (e) {
    // Always ACK with ok=false to prevent retries storms; log error
    if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.error("[wallet-webhook] error:", e);
    }
    return res.status(200).json({ ok: false, error: e.message });
  }
};

exports.transactions = async (req, res) => {
  try {
    const userId = req.params.userId || req.user.id;
    const rows = await Transaction.find({ userId: String(userId) })
      .sort({ createdAt: -1 })
      .lean();
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

exports.withdraw = async (req, res) => {
  try {
    const {
      amount,
      destination,
      method = "santimpay",
      paymentMethod,
      reason = "Wallet Withdrawal",
    } = req.body || {};
    if (!amount || amount <= 0)
      return res.status(400).json({ message: "amount must be > 0" });

    const userId = String(req.user.id);
    const role = "driver";
    if (req.user.type !== "driver")
      return res.status(403).json({ message: "Only drivers can withdraw" });

    const wallet = await Wallet.findOne({ userId, role });
    if (!wallet || wallet.balance < amount)
      return res.status(400).json({ message: "Insufficient balance" });
    // We DO NOT deduct until provider confirms success via webhook
    const tx = await Transaction.create({
      userId,
      role,
      amount,
      type: "debit",
      method,
      status: "pending",
      metadata: { destination, reason },
    });

    // Normalize Ethiopian MSISDN
    const normalizeMsisdnEt = (raw) => {
      if (!raw) return null;
      let s = String(raw).trim();
      s = s.replace(/\s+/g, "").replace(/[-()]/g, "");
      if (/^\+?251/.test(s)) {
        s = s.replace(/^\+?251/, "+251");
      } else if (/^0\d+/.test(s)) {
        s = s.replace(/^0/, "+251");
      } else if (/^9\d{8}$/.test(s)) {
        s = "+251" + s;
      }
      if (!/^\+2519\d{8}$/.test(s)) return null;
      return s;
    };
    // Kick off payout transfer
    const msisdn = normalizeMsisdnEt(
      destination || req.user.phone || req.user.phoneNumber
    );
    if (!msisdn)
      return res.status(400).json({ message: "Invalid destination phone" });
    const notifyUrl =
      process.env.SANTIMPAY_WITHDRAW_NOTIFY_URL ||
      `${process.env.PUBLIC_BASE_URL || ""}/v1/wallet/webhook`;
    try {
      // Resolve payment method from explicit param or driver's selected PaymentOption
      async function resolvePaymentMethodWithdraw() {
        const pick = (v) => (typeof v === 'string' && v.trim().length) ? v.trim() : null;
        const explicit = pick(paymentMethod);
        if (explicit) return explicit;
        try {
          const { Driver } = require("../models/userModels");
          const me = await Driver.findById(String(userId)).select({ paymentPreference: 1 }).populate({ path: 'paymentPreference', select: { name: 1 } });
          const name = me && me.paymentPreference && me.paymentPreference.name ? String(me.paymentPreference.name).trim() : null;
          if (name) return name;
        } catch (_) {}
        const err = new Error('paymentMethod is required and no driver payment preference is set');
        err.status = 400;
        throw err;
      }
      const normalizePaymentMethod2 = (method) => {
        const m = String(method || "").trim().toLowerCase();
        if (m === "telebirr" || m === "tele") return "Telebirr";
        if (m === "cbe" || m === "cbe-birr" || m === "cbebirr") return "CBE";
        if (m === "hellocash" || m === "hello-cash") return "HelloCash";
        return method;
      };
      const pm = normalizePaymentMethod2(await resolvePaymentMethodWithdraw());
      const gw = await santim.payoutTransfer({
        id: tx._id.toString(),
        amount,
        paymentReason: reason,
        phoneNumber: msisdn,
        paymentMethod: pm,
        notifyUrl,
      });
      const gwTxnId =
        gw?.TxnId || gw?.txnId || gw?.data?.TxnId || gw?.data?.txnId;
      await Transaction.findByIdAndUpdate(tx._id, {
        txnId: gwTxnId,
        metadata: { ...tx.metadata, gatewayResponse: gw },
      });
    } catch (err) {
      await Transaction.findByIdAndUpdate(tx._id, {
        status: "failed",
        metadata: { ...tx.metadata, gatewayError: err.message },
      });
      return res
        .status(502)
        .json({ message: `Payout initiation failed: ${err.message}` });
    }

    return res.status(202).json({
      message: "Withdrawal initiated",
      transactionId: tx._id.toString(),
    });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};
