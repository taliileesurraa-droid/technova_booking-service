const crypto = require("crypto");
const axios = require("axios");
require("dotenv").config();

const BASE_URL =
  process.env.SANTIMPAY_BASE_URL || "https://gateway.santimpay.com/api";
const GATEWAY_MERCHANT_ID = process.env.GATEWAY_MERCHANT_ID;
const PRIVATE_KEY_IN_PEM = process.env.PRIVATE_KEY_IN_PEM;

function importPrivateKey(pem) {
  return crypto.createPrivateKey({ key: pem, format: "pem" });
}

function signES256(payload, privateKeyPem) {
  const header = { alg: "ES256", typ: "JWT" };
  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const sign = crypto.createSign("SHA256");
  sign.update(unsigned);
  sign.end();
  const key = importPrivateKey(privateKeyPem);
  const signature = sign
    .sign({ key, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  return `${unsigned}.${signature}`;
}

function tokenForInitiatePayment(amount, paymentReason) {
  const time = Math.floor(Date.now() / 1000);
  const payload = {
    amount,
    paymentReason,
    merchantId: GATEWAY_MERCHANT_ID,
    generated: time,
  };
  return signES256(payload, PRIVATE_KEY_IN_PEM);
}

function tokenForDirectPayment(
  amount,
  paymentReason,
  paymentMethod,
  phoneNumber
) {
  const time = Math.floor(Date.now() / 1000);
  const payload = {
    amount,
    paymentReason,
    paymentMethod,
    phoneNumber,
    merchantId: GATEWAY_MERCHANT_ID,
    generated: time,
  };
  return signES256(payload, PRIVATE_KEY_IN_PEM);
}

function tokenForGetTransaction(id) {
  const time = Math.floor(Date.now() / 1000);
  const payload = { id, merId: GATEWAY_MERCHANT_ID, generated: time };
  return signES256(payload, PRIVATE_KEY_IN_PEM);
}

async function initiatePayment({
  id,
  amount,
  paymentReason,
  successRedirectUrl,
  failureRedirectUrl,
  notifyUrl,
  phoneNumber = "",
  cancelRedirectUrl = "",
}) {
  const token = tokenForInitiatePayment(amount, paymentReason);
  const payload = {
    id,
    amount,
    reason: paymentReason,
    merchantId: GATEWAY_MERCHANT_ID,
    signedToken: token,
    successRedirectUrl,
    failureRedirectUrl,
    notifyUrl,
    cancelRedirectUrl,
  };
  if (phoneNumber) payload.phoneNumber = phoneNumber;
  try {
    const res = await axios.post(`${BASE_URL}/initiate-payment`, payload, {
      headers: { "Content-Type": "application/json" },
    });
    return res.data;
  } catch (e) {
    const status = e.response?.status || "ERR";
    const data = e.response?.data;
    const text = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`SantimPay initiate-payment failed: ${status} ${text}`);
  }
}

async function directPayment({
  id,
  amount,
  paymentReason,
  notifyUrl,
  phoneNumber,
  paymentMethod,
}) {
  const token = tokenForDirectPayment(
    amount,
    paymentReason,
    paymentMethod,
    phoneNumber
  );
  const payload = {
    id,
    amount,
    reason: paymentReason,
    merchantId: GATEWAY_MERCHANT_ID,
    signedToken: token,
    phoneNumber,
    paymentMethod,
    notifyUrl,
  };
  try {
    const res = await axios.post(`${BASE_URL}/direct-payment`, payload, {
      headers: { "Content-Type": "application/json" },
    });
    return res.data; // expect provider response with TxnId, etc.
  } catch (e) {
    const status = e.response?.status || "ERR";
    const data = e.response?.data;
    const text = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`SantimPay direct-payment failed: ${status} ${text}`);
  }
}

async function payoutTransfer({
  id,
  amount,
  paymentReason,
  phoneNumber,
  paymentMethod,
  notifyUrl,
}) {
  const token = tokenForDirectPayment(
    amount,
    paymentReason,
    paymentMethod,
    phoneNumber
  );
  const payload = {
    id,
    clientReference: id,
    amount,
    reason: paymentReason,
    merchantId: GATEWAY_MERCHANT_ID,
    signedToken: token,
    receiverAccountNumber: phoneNumber,
    notifyUrl,
    paymentMethod,
  };
  try {
    const res = await axios.post(`${BASE_URL}/payout-transfer`, payload, {
      headers: { "Content-Type": "application/json" },
    });
    return res.data;
  } catch (e) {
    const status = e.response?.status || "ERR";
    const data = e.response?.data;
    const text = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`SantimPay payout-transfer failed: ${status} ${text}`);
  }
}

async function checkTransactionStatus(id) {
  const token = tokenForGetTransaction(id);
  const payload = { id, merchantId: GATEWAY_MERCHANT_ID, signedToken: token };
  try {
    const res = await axios.post(
      `${BASE_URL}/fetch-transaction-status`,
      payload,
      { headers: { "Content-Type": "application/json" } }
    );
    return res.data;
  } catch (e) {
    const status = e.response?.status || "ERR";
    const data = e.response?.data;
    const text = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(
      `SantimPay fetch-transaction-status failed: ${status} ${text}`
    );
  }
}

module.exports = {
  signES256,
  initiatePayment,
  directPayment,
  payoutTransfer,
  checkTransactionStatus,
};
