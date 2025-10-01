const passengerService = require('../services/passengerService');
const errorHandler = require('../utils/errorHandler');

exports.create = async (req, res) => {
  try {
    const result = await passengerService.create(req.body || {});
    return res.status(201).json(result);
  } catch (e) { errorHandler(res, e); }
};

exports.list = async (req, res) => {
  try {
    const rows = await passengerService.list();
    return res.json(rows);
  } catch (e) { errorHandler(res, e); }
};

exports.get = async (req, res) => {
  try {
    const row = await passengerService.get(req.params.id);
    if (!row) return res.status(404).json({ message: 'Passenger not found' });
    return res.json(row);
  } catch (e) { errorHandler(res, e); }
};

exports.update = async (req, res) => {
  try {
    const updated = await passengerService.update(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ message: 'Passenger not found' });
    return res.json(updated);
  } catch (e) { errorHandler(res, e); }
};

exports.remove = async (req, res) => {
  try {
    const r = await passengerService.remove(req.params.id);
    if (!r) return res.status(404).json({ message: 'Passenger not found' });
    return res.status(204).send();
  } catch (e) { errorHandler(res, e); }
};

exports.getMyProfile = async (req, res) => {
  try {
    if (req.user.type !== 'passenger') return res.status(403).json({ message: 'Only passengers can access this endpoint' });
    const passenger = await passengerService.getMyProfile(req.user.id);
    if (!passenger) return res.status(404).json({ message: 'Passenger not found' });
    return res.json(passenger);
  } catch (e) { errorHandler(res, e); }
};

exports.updateMyProfile = async (req, res) => {
  try {
    if (req.user.type !== 'passenger') return res.status(403).json({ message: 'Only passengers can access this endpoint' });
    const updated = await passengerService.updateMyProfile(req.user.id, req.body || {});
    if (!updated) return res.status(404).json({ message: 'Passenger not found' });
    return res.json(updated);
  } catch (e) { errorHandler(res, e); }
};

exports.deleteMyAccount = async (req, res) => {
  try {
    if (req.user.type !== 'passenger') return res.status(403).json({ message: 'Only passengers can delete their account' });
    const r = await passengerService.deleteMyAccount(req.user.id);
    if (!r) return res.status(404).json({ message: 'Passenger not found' });
    return res.status(204).send();
  } catch (e) { errorHandler(res, e); }
};

exports.rateDriver = async (req, res) => {
  try {
    if (req.user.type !== 'passenger') return res.status(403).json({ message: 'Only passengers can rate drivers' });
    const { rating } = req.body;
    const driverId = req.params.driverId;
    const driver = await passengerService.rateDriver(driverId, rating);
    return res.json({ message: 'Driver rated successfully', driver });
  } catch (e) { errorHandler(res, e); }
};

