const bookingSocket = require('./bookingSocket');
const driverSocket = require('./driverSocket');
const passengerSocket = require('./passengerSocket');
const liveSocket = require('./liveSocket');
const { socketAuth } = require('../utils/jwt');
const { setIo } = require('./utils');
const logger = require('../utils/logger');

function attachSocketHandlers(io) {
  setIo(io);
  io.use(socketAuth);
  io.on('connection', (socket) => {
    try { logger.info('[socket] connected', { sid: socket.id, user: socket.user && { id: socket.user.id, type: socket.user.type } }); } catch (_) {}
    bookingSocket(io, socket);
    driverSocket(io, socket);
    passengerSocket(io, socket);
    liveSocket(io, socket);
    socket.on('disconnect', (reason) => {
      try { logger.info('[socket] disconnected', { sid: socket.id, reason }); } catch (_) {}
    });
  });
}

module.exports = { attachSocketHandlers };

