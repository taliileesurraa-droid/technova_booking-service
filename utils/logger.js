const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

function info(...args) {
  if (!isProduction) {
    try { console.log(...args); } catch (_) {}
  }
}

function warn(...args) {
  if (!isProduction) {
    try { console.warn(...args); } catch (_) {}
  }
}

function error(...args) {
  try { console.error(...args); } catch (_) {}
}

module.exports = { info, warn, error };
