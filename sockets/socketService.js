const { setIo } = require('../sockets/utils');
const logger = require('../utils/logger');
const attachSocketHandlers = require('../sockets');

function initializeSocket(io) {
  // Avoid multiple nested connection handlers; attach once globally
  try { io.setMaxListeners && io.setMaxListeners(50); } catch (_) {}
  setIo(io);
  // Delegate full setup (auth + connection + handlers) to sockets/index.js
  if (attachSocketHandlers && typeof attachSocketHandlers.attachSocketHandlers === 'function') {
    attachSocketHandlers.attachSocketHandlers(io);
    logger.info('[socket] handlers attached');
  } else {
    logger.error('[socket] failed to attach handlers');
  }
}

module.exports = { initializeSocket };

