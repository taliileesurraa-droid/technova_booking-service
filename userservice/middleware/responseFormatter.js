const { Passenger, Driver } = require('../models/userModels');

async function enrichEntity(entity) {
  if (!entity || typeof entity !== 'object') return entity;

  const clone = Array.isArray(entity) ? entity.slice() : { ...entity };

  // If array, enrich each item
  if (Array.isArray(clone)) {
    return Promise.all(clone.map(item => enrichEntity(item)));
  }

  // Try to enrich passenger info
  if (clone.passengerId && !clone.passenger) {
    try {
      const p = await Passenger.findById(clone.passengerId).select({ _id: 1, name: 1 }).lean();
      if (p) clone.passenger = { id: String(p._id), name: p.name };
    } catch (_) {}
  }
  // If embedded passenger object missing name but has id, try fill name
  if (clone.passenger && !clone.passenger.name && (clone.passenger.id || clone.passenger._id)) {
    try {
      const pid = clone.passenger.id || clone.passenger._id;
      const p = await Passenger.findById(pid).select({ _id: 1, name: 1 }).lean();
      if (p) clone.passenger = { id: String(p._id), name: p.name };
    } catch (_) {}
  }

  // Try to enrich driver info
  if (clone.driverId && !clone.driver) {
    try {
      const d = await Driver.findById(clone.driverId).select({ _id: 1, name: 1 }).lean();
      if (d) clone.driver = { id: String(d._id), name: d.name };
    } catch (_) {}
  }
  if (clone.driver && !clone.driver.name && (clone.driver.id || clone.driver._id)) {
    try {
      const did = clone.driver.id || clone.driver._id;
      const d = await Driver.findById(did).select({ _id: 1, name: 1 }).lean();
      if (d) clone.driver = { id: String(d._id), name: d.name };
    } catch (_) {}
  }

  return clone;
}

module.exports = function responseFormatter() {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = async (payload) => {
      try {
        const data = await enrichEntity(payload);
        const body = { success: res.statusCode < 400, data };
        return originalJson(body);
      } catch (e) {
        // If enrichment fails, fall back to original payload
        return originalJson({ success: res.statusCode < 400, data: payload });
      }
    };
    next();
  };
};


