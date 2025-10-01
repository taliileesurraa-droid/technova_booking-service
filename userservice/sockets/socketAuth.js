const jwt = require('jsonwebtoken');

async function authenticateSocket(socket) {
  try {
    // Expect token in query or headers
    const token = socket.handshake.auth?.token || socket.handshake.query?.token || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    // Normalize basic fields used by callers
    return {
      id: decoded.id,
      type: decoded.type,
      name: decoded.name || decoded.fullName || decoded.displayName,
      phone: decoded.phone || decoded.phoneNumber || decoded.mobile,
      email: decoded.email,
      vehicleType: decoded.vehicleType
    };
  } catch (_) {
    return null;
  }
}

module.exports = { authenticateSocket };


