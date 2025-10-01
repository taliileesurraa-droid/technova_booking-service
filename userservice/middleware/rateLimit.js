const rateLimit = require('express-rate-limit');

module.exports = (opts = {}) => rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false, ...opts });

