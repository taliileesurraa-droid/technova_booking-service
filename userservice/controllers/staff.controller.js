const { Staff } = require('../models/userModels');
const { crudController } = require('./basic.crud');
const { listStaff, getStaffById } = require('../integrations/userServiceClient');

const base = { ...crudController(Staff) };

base.list = async (req, res) => {
  try {
    const rows = await listStaff(req.query);
    return res.json(rows);
  } catch (e) { return res.status(500).json({ message: `Failed to list staff: ${e.message}` }); }
};

base.get = async (req, res) => {
  try {
    const s = await getStaffById(req.params.id);
    if (!s) return res.status(404).json({ message: 'Staff not found' });
    return res.json(s);
  } catch (e) { return res.status(500).json({ message: `Failed to get staff: ${e.message}` }); }
};

module.exports = base;


