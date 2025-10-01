const { Passenger } = require('../models/userModels');
const { hashPassword } = require('../utils/password');

async function create(data) {
  const payload = { ...data };
  if (payload.password) payload.password = await hashPassword(payload.password);
  const row = await Passenger.create(payload);
  const passengerWithRoles = await Passenger.findById(row._id).populate('roles').lean();
  return passengerWithRoles;
}

async function list() {
  const rows = await Passenger.find().populate('roles').lean();
  return rows;
}

async function get(id) {
  const row = await Passenger.findById(id).populate('roles').lean();
  return row;
}

async function update(id, body) {
  const allowedFields = ['name', 'phone', 'email', 'emergencyContacts', 'contractId', 'wallet', 'rewardPoints'];
  const data = {};
  for (const key of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, key)) data[key] = body[key];
  }
  if (body.password) {
    data.password = await hashPassword(body.password);
  }
  if ('rating' in data) delete data.rating;
  if ('ratingCount' in data) delete data.ratingCount;
  if (Object.keys(data).length === 0) {
    const err = new Error('No updatable fields provided.');
    err.status = 400;
    throw err;
  }
  const updated = await Passenger.findByIdAndUpdate(id, data, { new: true }).populate('roles').lean();
  return updated;
}

async function remove(id) {
  const r = await Passenger.findByIdAndDelete(id);
  return r;
}

async function getMyProfile(userId) {
  const passenger = await Passenger.findById(userId).populate('roles').lean();
  return passenger;
}

async function updateMyProfile(userId, body) {
  const data = { ...body };
  if ('rating' in data) delete data.rating;
  if ('ratingCount' in data) delete data.ratingCount;
  if ('rewardPoints' in data) delete data.rewardPoints;
  if (data.password) data.password = await hashPassword(data.password);
  const updated = await Passenger.findByIdAndUpdate(userId, data, { new: true }).populate('roles').lean();
  return updated;
}

async function deleteMyAccount(userId) {
  const r = await Passenger.findByIdAndDelete(userId);
  return r;
}

async function rateDriver(driverId, rating) {
  const { Driver } = require('../models/userModels');
  const driver = await Driver.findById(driverId);
  if (!driver) {
    const err = new Error('Driver not found');
    err.status = 404;
    throw err;
  }
  const value = Number(rating);
  if (!Number.isFinite(value) || value < 0 || value > 5) {
    const err = new Error('Invalid rating. Must be between 0 and 5.');
    err.status = 400;
    throw err;
  }
  const newRating = Math.max(0, Math.min(5, value));
  driver.rating = newRating;
  await driver.save();
  return driver;
}

module.exports = {
  create,
  list,
  get,
  update,
  remove,
  getMyProfile,
  updateMyProfile,
  deleteMyAccount,
  rateDriver
};

