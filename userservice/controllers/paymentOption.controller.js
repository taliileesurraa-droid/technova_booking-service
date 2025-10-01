const PaymentOption = require('../models/paymentOption');

exports.list = async (req, res) => {
  try {
    const rows = await PaymentOption.find({}).select({ name: 1, logo: 1 }).sort({ name: 1 }).lean();
    return res.json(rows.map(r => ({ id: String(r._id), name: r.name, logo: r.logo })));
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, logo } = req.body || {};
    if (!name || String(name).trim() === '') return res.status(400).json({ message: 'name is required' });
    const exists = await PaymentOption.findOne({ name: String(name).trim() }).lean();
    if (exists) return res.status(409).json({ message: 'Payment option already exists' });
    const row = await PaymentOption.create({ name: String(name).trim(), logo });
    return res.status(201).json({ id: String(row._id), name: row.name, logo: row.logo });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};