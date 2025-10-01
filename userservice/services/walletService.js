const mongoose = require('mongoose');

// Prefer existing models/common if available
let WalletModel = null;
let TransactionModel = null;
try {
  const common = require('../models/common');
  WalletModel = common.Wallet;
  TransactionModel = common.Transaction;
} catch (e) {
  const wallet = require('../models/walletModel');
  WalletModel = wallet.Wallet;
}

const financeService = require('./financeService');

async function credit(userId, amount, description = '') {
  if (!WalletModel) return null;
  if (TransactionModel) {
    // transactional via separate Transaction collection
    await WalletModel.updateOne(
      { userId: String(userId), role: 'driver' },
      { $inc: { balance: Number(amount || 0), totalEarnings: Number(amount || 0) } },
      { upsert: true }
    );
    const tx = await TransactionModel.create({
      userId: String(userId),
      role: 'driver',
      amount: Number(amount || 0),
      type: 'credit',
      method: 'wallet',
      status: 'success',
      metadata: { description }
    });
    return tx;
  }
  // embedded transactions
  return WalletModel.findOneAndUpdate(
    { userId },
    { $inc: { balance: Number(amount || 0) }, $push: { transactions: { type: 'credit', amount: Number(amount || 0), description } } },
    { new: true, upsert: true }
  );
}

async function debit(userId, amount, description = '') {
  if (!WalletModel) return null;
  if (TransactionModel) {
    await WalletModel.updateOne(
      { userId: String(userId), role: 'passenger' },
      { $inc: { balance: -Number(amount || 0) } },
      { upsert: true }
    );
    const tx = await TransactionModel.create({
      userId: String(userId),
      role: 'passenger',
      amount: Number(amount || 0),
      type: 'debit',
      method: 'wallet',
      status: 'success',
      metadata: { description }
    });
    return tx;
  }
  return WalletModel.findOneAndUpdate(
    { userId },
    { $inc: { balance: -Number(amount || 0) }, $push: { transactions: { type: 'debit', amount: Number(amount || 0), description } } },
    { new: true, upsert: true }
  );
}

async function getWallet(userId) {
  if (!WalletModel) return null;
  return WalletModel.findOne({ userId });
}

module.exports = { credit, debit, getWallet };

/**
 * Convert a provider deposit to package value based on dynamic commission rate.
 * Does not mutate wallet; returns computed package amount for caller to apply.
 */
async function convertProviderDepositToPackage(providerAmount, commissionRate) {
  return financeService.calculatePackage(providerAmount, commissionRate);
}

module.exports.convertProviderDepositToPackage = convertProviderDepositToPackage;

