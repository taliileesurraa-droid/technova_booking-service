const attachSocketHandlers = require('../sockets');

function initializeSocket(io) {
  // Register core handlers ONCE. Avoid nesting io.on('connection') registrations per connection.
  try { attachSocketHandlers.attachSocketHandlers && attachSocketHandlers.attachSocketHandlers(io); } catch (_) {}
}

module.exports = { initializeSocket };

