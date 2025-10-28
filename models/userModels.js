const mongoose = require('mongoose');

const RoleSchema = new mongoose.Schema({ name: { type: String, required: true, unique: true } }, { timestamps: true });
const PermissionSchema = new mongoose.Schema({ name: { type: String, required: true, unique: true } }, { timestamps: true });

const PassengerSchema = new mongoose.Schema({
  externalId: { type: String, index: true },
  name: { type: String, required: true },
  phone: { type: String, index: true, unique: true },
  email: { type: String, index: true, unique: true },
  password: { type: String, required: true },
  emergencyContacts: [{ name: String, phone: String }],
  roles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }]
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

PassengerSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.password;
    return ret;
  }
});

const DriverSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  externalId: { type: String, index: true },
  name: { type: String },
  phone: { type: String },
  email: { type: String },
  password: { type: String },
  vehicleType: { type: String, enum: ['mini', 'sedan', 'suv', 'mpv'] },
  available: { type: Boolean, default: false },
  lastKnownLocation: { 
    latitude: Number, 
    longitude: Number,
    bearing: { type: Number, min: 0, max: 360 } // Bearing in degrees (0-360)
  },
  // Vehicle information
  carPlate: { type: String },
  carModel: { type: String },
  carColor: { type: String },
  // Rating information
  rating: { type: Number, default: 5.0, min: 1, max: 5 },
  ratingCount: { type: Number, default: 0 },
  paymentPreference: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentOption',
    default: null
  },
  roles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }]
}, { timestamps: true, _id: false, toJSON: { versionKey: false }, toObject: { versionKey: false } });

DriverSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    // Normalize id field to id
    ret.id = String(ret._id);
    delete ret._id;
    // Remove sensitive/internal fields
    delete ret.password;
    delete ret.ratingCount;
    return ret;
  }
});

// Ensure unique only when phone/email are present
DriverSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $exists: true, $type: 'string' } } }
);
DriverSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $exists: true, $type: 'string' } } }
);

const StaffSchema = new mongoose.Schema({
  externalId: { type: String, index: true },
  fullName: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  roles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }]
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

StaffSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.password;
    return ret;
  }
});

const AdminSchema = new mongoose.Schema({
  externalId: { type: String, index: true },
  fullName: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  roles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }]
}, { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } });

AdminSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.password;
    return ret;
  }
});

module.exports = {
  Role: mongoose.model('Role', RoleSchema),
  Permission: mongoose.model('Permission', PermissionSchema),
  Passenger: mongoose.model('Passenger', PassengerSchema),
  Driver: mongoose.model('Driver', DriverSchema),
  Staff: mongoose.model('Staff', StaffSchema),
  Admin: mongoose.model('Admin', AdminSchema)
};

