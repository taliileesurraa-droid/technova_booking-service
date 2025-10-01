const mongoose = require('mongoose');

const WalletSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  role: { type: String, enum: ['passenger','driver'], required: true, index: true },
  balance: { type: Number, default: 0 },
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

const TransactionSchema = new mongoose.Schema({
  txnId: { type: String, index: true },
  refId: { type: String },
  userId: { type: String, required: true, index: true },
  role: { type: String, enum: ['passenger','driver'], required: true },
  amount: { type: Number, required: true },
  type: { type: String, enum: ['credit','debit'], required: true },
  method: { type: String, enum: ['cash','wallet','telebirr','cbe','card','santimpay'], required: true },
  status: { type: String, enum: ['pending','success','failed'], default: 'pending', index: true },
  metadata: { type: Object },
  commission: { type: Number },
  totalAmount: { type: Number },
  msisdn: { type: String }
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

const LocationSchema = new mongoose.Schema({
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  address: { type: String }
}, { _id: false });

const VehicleTypeEnum = ['mini', 'sedan', 'van'];

const Wallet =  mongoose.model('Wallet', WalletSchema);
const Transaction =  mongoose.model('Transaction', TransactionSchema);

module.exports = {
  Wallet,
  Transaction,
  LocationSchema,
  VehicleTypeEnum
};

