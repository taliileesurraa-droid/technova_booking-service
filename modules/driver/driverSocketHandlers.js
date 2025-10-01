const logger = require('../../utils/logger');

module.exports = function registerDriverSocketHandlers(io, socket) {
  socket.on('driver:availability', (payload) => {
    logger.info('[socket] driver:availability received - handled elsewhere for now');
  });
};

