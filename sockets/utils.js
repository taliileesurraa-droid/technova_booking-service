let ioRef = null;
const logger = require('../utils/logger');

function setIo(io) {
  ioRef = io;
}

function getIo() {
  return ioRef;
}

function broadcast(event, data) {
  const io = ioRef;
  if (io) {
    try {
      io.emit(event, data);
    } catch (e) {
      logger.error('Failed to broadcast event', event, e);
    }
  } else {
    logger.warn('Socket.io not initialized for broadcast.');
  }
}

const sendMessageToSocketId = (socketId, messageObject) => {
  const io = ioRef;
  if (io) {
    try {
      logger.info('message sent to: ', socketId);
      io.to(socketId).emit(messageObject.event, messageObject.data);
    } catch (e) {
      logger.error('Failed to send message to socket', socketId, e);
    }
  } else {
    logger.warn('Socket.io not initialized.');
  }
};

module.exports = { setIo, getIo, broadcast, sendMessageToSocketId };
