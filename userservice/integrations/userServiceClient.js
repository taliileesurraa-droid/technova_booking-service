const axios = require('axios');

function buildUrlFromTemplate(template, params) {
  if (!template) return null;
  return Object.keys(params || {}).reduce(
    (acc, key) => acc.replace(new RegExp(`{${key}}`, 'g'), encodeURIComponent(String(params[key]))),
    template
  );
}

function getAuthHeaders(tokenOrHeader) {
  const headers = { 'Accept': 'application/json' };
  if (tokenOrHeader) {
    if (typeof tokenOrHeader === 'string') {
      headers['Authorization'] = tokenOrHeader.startsWith('Bearer ') ? tokenOrHeader : `Bearer ${tokenOrHeader}`;
    } else if (typeof tokenOrHeader === 'object' && tokenOrHeader.Authorization) {
      headers['Authorization'] = tokenOrHeader.Authorization;
    }
  } else if (process.env.AUTH_SERVICE_BEARER) {
    headers['Authorization'] = `Bearer ${process.env.AUTH_SERVICE_BEARER}`;
  }
  return headers;
}

async function httpGet(url, headers) {
  const timeout = parseInt(process.env.USER_SERVICE_TIMEOUT_MS || process.env.HTTP_TIMEOUT_MS || '5000');
  const res = await axios.get(url, { headers, timeout });
  return res.data;
}

async function httpPost(url, body, headers) {
  const timeout = parseInt(process.env.USER_SERVICE_TIMEOUT_MS || process.env.HTTP_TIMEOUT_MS || '5000');
  const res = await axios.post(url, body, { headers: { 'Content-Type': 'application/json', ...(headers || {}) }, timeout });
  return res.data;
}

// Low-level helpers driven by env configuration
function getAuthBase() {
  return (process.env.AUTH_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function getTemplate(name) {
  return process.env[name] || null;
}

// External-only API (auth service)
async function getPassengerDetails(id, token) {
  try {
    const tpl = getTemplate('PASSENGER_LOOKUP_URL_TEMPLATE') || `${getAuthBase()}/passengers/{id}`;
    const url = buildUrlFromTemplate(tpl, { id });
    const data = await httpGet(url, getAuthHeaders(token));
    const u = data?.data || data?.user || data?.passenger || data;
    return { success: true, user: { id: String(u.id || u._id || id), name: u.name, phone: u.phone, email: u.email, externalId: u.externalId } };
  } catch (e) {
    return { success: false, message: e.response?.data?.message || e.message };
  }
}

async function getDriverDetails(id, token) {
  try {
    const tpl = getTemplate('DRIVER_LOOKUP_URL_TEMPLATE') || `${getAuthBase()}/drivers/{id}`;
    const url = buildUrlFromTemplate(tpl, { id });
    const data = await httpGet(url, getAuthHeaders(token));
    const u = data?.data || data?.user || data?.driver || data;
    return { success: true, user: { id: String(u.id || u._id || id), name: u.name, phone: u.phone, email: u.email, externalId: u.externalId, vehicleType: u.vehicleType, carPlate: u.carPlate, carModel: u.carModel, carColor: u.carColor, rating: u.rating, available: u.available, lastKnownLocation: u.lastKnownLocation, paymentPreference: u.paymentPreference,} };
  } catch (e) {
    return { success: false, message: e.response?.data?.message || e.message };
  }
}

async function getDriverById(id, options) {
  const token = options && options.headers ? options.headers.Authorization : undefined;
  let res = await getDriverDetails(id, token);
  if (!res.success) {
    // Fallback to service bearer if provided
    res = await getDriverDetails(id, undefined);
  }
  if (!res.success) return null;
  return {
    id: String(res.user.id),
    name: res.user.name,
    phone: res.user.phone,
    email: res.user.email,
    vehicleType: res.user.vehicleType,
    carPlate: res.user.carPlate,
    carModel: res.user.carModel,
    carColor: res.user.carColor,
    rating: res.user.rating,
    available: res.user.available,
    lastKnownLocation: res.user.lastKnownLocation,
    paymentPreference: res.user.paymentPreference,
  };
}

async function getPassengerById(id, options) {
  const token = options && options.headers ? options.headers.Authorization : undefined;
  const res = await getPassengerDetails(id, token);
  if (!res.success) return null;
  return { 
    id: String(res.user.id), 
    name: res.user.name, 
    phone: res.user.phone, 
    email: res.user.email,
    externalId: res.user.externalId,
    vehicleType: res.user.vehicleType,
    paymentPreference: res.user.paymentPreference
  };
}

async function getDriversByIds(ids = [], token) {
  try {
    const base = getAuthBase();
    const url = `${base}/drivers/batch`;
    const data = await httpPost(url, { ids }, getAuthHeaders(token));
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone, email: u.email, vehicleType: u.vehicleType, carPlate: u.carPlate, rating: u.rating, available: u.available, paymentPreference: u.paymentPreference }));
  } catch (e) {
    // Fallback per-id with internal fallback in getDriverById (will try service bearer)
    const results = await Promise.all((ids || []).map(id => getDriverById(id, {})));
    return results.filter(Boolean);
  }
}

async function listDrivers(query = {}, options) {
  try {
    const base = getAuthBase();
    const url = new URL(`${base}/drivers`);
    Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
    const token = options && options.headers ? options.headers.Authorization : undefined;
    let data = await httpGet(url.toString(), getAuthHeaders(token));
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone, email: u.email, vehicleType: u.vehicleType, carPlate: u.carPlate, rating: u.rating, available: u.available, paymentPreference: u.paymentPreference }));
  } catch (_) {
    try {
      // Fallback with service bearer
      const base = getAuthBase();
      const url = new URL(`${base}/drivers`);
      Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
      const data = await httpGet(url.toString(), getAuthHeaders(undefined));
      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone, email: u.email, vehicleType: u.vehicleType, carPlate: u.carPlate, rating: u.rating, available: u.available, paymentPreference: u.paymentPreference }));
    } catch (__) { return []; }
  }
}

async function listPassengers(query = {}, options) {
  try {
    const base = getAuthBase();
    const url = new URL(`${base}/passengers`);
    Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
    const data = await httpGet(url.toString(), getAuthHeaders(options && options.headers ? options.headers.Authorization : undefined));
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone, email: u.email }));
  } catch (_) { return []; }
}

async function getStaffById(id) {
  try {
    const base = getAuthBase();
    const url = `${base}/staff/${encodeURIComponent(String(id))}`;
    const data = await httpGet(url, getAuthHeaders());
    const u = data?.data || data || {};
    return { id: String(u.id || u._id || id), name: u.name, phone: u.phone };
  } catch (_) { return null; }
}

async function listStaff(query = {}) {
  try {
    const base = getAuthBase();
    const url = new URL(`${base}/staff`);
    Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
    const data = await httpGet(url.toString(), getAuthHeaders());
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone }));
  } catch (_) { return []; }
}

async function getAdminById(id) {
  try {
    const base = getAuthBase();
    const url = `${base}/admins/${encodeURIComponent(String(id))}`;
    const data = await httpGet(url, getAuthHeaders());
    const u = data?.data || data || {};
    return { id: String(u.id || u._id || id), name: u.name, phone: u.phone };
  } catch (_) { return null; }
}

async function listAdmins(query = {}) {
  try {
    const base = getAuthBase();
    const url = new URL(`${base}/admins`);
    Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
    const data = await httpGet(url.toString(), getAuthHeaders());
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone }));
  } catch (_) { return []; }
}

module.exports = {
  // high level
  getPassengerDetails,
  getDriverDetails,
  getDriversByIds,
  // compatibility with existing controllers
  getPassengerById,
  getDriverById,
  listDrivers,
  listPassengers,
  getStaffById,
  listStaff,
  getAdminById,
  listAdmins
};
