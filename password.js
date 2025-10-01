const bcrypt = require('bcryptjs');

const DEFAULT_ROUNDS = 10;

async function hashPassword(plain) {
  if (!plain) throw new Error('Password required');
  const salt = await bcrypt.genSalt(DEFAULT_ROUNDS);
  return bcrypt.hash(plain, salt);
}

async function comparePassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, comparePassword };