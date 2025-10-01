// authController.js (User Service)
const jwt = require('jsonwebtoken');
const { Passenger, Driver, Staff, Admin, Role } = require('../models/userModels');
const { hashPassword, comparePassword } = require('../utils/password');
const { generateUserInfoToken } = require('../utils/jwt');
require('dotenv').config();

exports.registerPassenger = async (req, res) => {
  try {
    const { name, phone, email, password, emergencyContacts } = req.body;
    const exists = await Passenger.findOne({ phone });
    if (exists) return res.status(409).json({ message: 'Phone already registered' });
    const hashed = await hashPassword(password);
    const passenger = await Passenger.create({ name, phone, email, emergencyContacts, password: hashed });
    // Passenger starts with no specific roles, can be assigned later
    const token = generateUserInfoToken(passenger.toJSON(), 'passenger', [], []);
    return res.status(201).json({ token, passenger });
  } catch (e) {
    console.error('Error registering passenger:', e);
    return res.status(500).json({ message: e.message });
  }
};

exports.loginPassenger = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
    const passenger = await Passenger.findOne({ email }).populate('roles');
    if (!passenger) return res.status(404).json({ message: 'Passenger not found' });
    const ok = await comparePassword(password, passenger.password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    const roleNames = (passenger.roles || []).map(r => r.name);
    const token = generateUserInfoToken(passenger.toJSON(), 'passenger', roleNames, []);
    return res.json({ token, passenger });
  } catch (e) {
    console.error('Error logging in passenger:', e);
    return res.status(500).json({ message: e.message });
  }
};

exports.registerDriver = async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    const exists = await Driver.findOne({ phone });
    if (exists) return res.status(409).json({ message: 'Phone already registered' });
    const hashed = await hashPassword(password);
    const driver = await Driver.create({ _id: phone, name, phone, email, password: hashed, status: 'pending' });
    // Driver starts with no specific roles, can be assigned later
    const token = generateUserInfoToken(driver.toJSON(), 'driver', [], []);
    return res.status(201).json({ token, driver });
  } catch (e) {
    console.error('Error registering driver:', e);
    return res.status(500).json({ message: e.message });
  }
};

exports.loginDriver = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
    const driver = await Driver.findOne({ email }).populate('roles');
    if (!driver) return res.status(404).json({ message: 'Driver not found' }); // More specific message
    const ok = await comparePassword(password, driver.password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    const roleNames = (driver.roles || []).map(r => r.name);
    const token = generateUserInfoToken(driver.toJSON(), 'driver', roleNames, []);
    return res.json({ token, driver });
  } catch (e) {
    console.error('Error logging in driver:', e);
    return res.status(500).json({ message: e.message });
  }
};

exports.registerStaff = async (req, res) => {
  try {
    const { fullName, username, password } = req.body;
    const exists = await Staff.findOne({ username });
    if (exists) return res.status(409).json({ message: 'Username already exists' });
    const hashed = await hashPassword(password);
    const staff = await Staff.create({ fullName, username, password: hashed });
    // Staff starts with no specific roles, can be assigned later
    const token = generateUserInfoToken(staff.toJSON(), 'staff', [], []);
    return res.status(201).json({ token, staff });
  } catch (e) {
    console.error('Error registering staff:', e);
    return res.status(500).json({ message: e.message });
  }
};

exports.loginStaff = async (req, res) => {
  try {
    const { username, password } = req.body;
    const staff = await Staff.findOne({ username }).populate({ path: 'roles' });
    if (!staff) return res.status(404).json({ message: 'Staff user not found' }); // More specific message
    const ok = await comparePassword(password, staff.password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    const roles = (staff.roles || []).map(r => r.name);
    const token = generateUserInfoToken(staff.toJSON(), 'staff', roles, []);
    return res.json({ token, staff });
  } catch (e) {
    console.error('Error logging in staff:', e);
    return res.status(500).json({ message: e.message });
  }
};

exports.registerAdmin = async (req, res) => {
  try {
    const { fullName, username, password, email } = req.body;
    const exists = await Admin.findOne({ username });
    if (exists) return res.status(409).json({ message: 'Username already exists' });
    const hashed = await hashPassword(password);
    const admin = await Admin.create({ fullName, username, password: hashed, email });
    const superAdminRole = await Role.findOne({ name: 'superadmin' });
    if (superAdminRole) {
      admin.roles = admin.roles || [];
      admin.roles.push(superAdminRole._id);
      await admin.save();
    } else {
      console.warn('Superadmin role not found. Please ensure it is created.');
    }

    const token = generateUserInfoToken(admin.toJSON(), 'admin', ['superadmin'], []);

    // Return clean admin object without sensitive information
    const cleanAdmin = {
      id: admin.id,
      fullName: admin.fullName,
      username: admin.username,
      email: admin.email,
      roles: ['superadmin'] // Just the role names
    };

    return res.status(201).json({ token, admin: cleanAdmin });
  } catch (e) {
    console.error('Error registering admin:', e);
    return res.status(500).json({ message: e.message });
  }
};

exports.loginAdmin = async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username }).populate('roles');
    if (!admin) return res.status(404).json({ message: 'Admin not found' }); // More specific message
    const ok = await comparePassword(password, admin.password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    const roles = (admin.roles || []).map(r => r.name);
    const isSuperAdmin = roles.includes('superadmin');
    const token = generateUserInfoToken(admin.toJSON(), 'admin', roles, []);

    // Return clean admin object without detailed role/permission information
    const cleanAdmin = {
      id: admin.id,
      fullName: admin.fullName,
      username: admin.username,
      email: admin.email,
      roles: roles // Just the role names, not the full objects
    };

    return res.json({ token, admin: cleanAdmin });
  } catch (e) {
    console.error('Error logging in admin:', e);
    return res.status(500).json({ message: e.message });
  }
};