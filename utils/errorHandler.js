function errorHandler(res, err, statusCode) {
  try {
    const status = statusCode || err.status || err.statusCode || 500;
    const message = err && (err.message || err.toString ? err.toString() : 'Internal Server Error');
    if (process.env.NODE_ENV !== 'production') {
      // Include stack in non-production for easier debugging
      return res.status(status).json({ message, ...(err.stack ? { stack: err.stack } : {}) });
    }
    return res.status(status).json({ message });
  } catch (_) {
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

module.exports = errorHandler;

