// Reuse existing Wallet/Transaction models from models/common to avoid duplication
try {
  const { Wallet, Transaction } = require('./common');
  module.exports = { Wallet, Transaction };
} catch (e) {
  const mongoose = require('mongoose');
  const walletSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, refPath: 'userType' },
    userType: { type: String, enum: ['Driver', 'Passenger', 'Admin'] },
    balance: { type: Number, default: 0 },
    transactions: [{
      type: { type: String, enum: ['credit', 'debit'] },
      amount: Number,
      description: String,
      timestamp: { type: Date, default: Date.now }
    }]
  }, { timestamps: true });
  const Wallet = mongoose.model('Wallet', walletSchema);
  module.exports = { Wallet };
}

