const jwt = require('jsonwebtoken');
require('dotenv').config();
const axios = require('axios');

// Minimal JWKS cache
const jwksCache = { keys: {}, fetchedAt: 0 };
async function getSigningKey(kid) {
  const jwksUrl = process.env.AUTH_JWKS_URL;
  if (!jwksUrl) return null;
  const now = Date.now();
  if (jwksCache.fetchedAt && (now - jwksCache.fetchedAt) < 5 * 60 * 1000 && jwksCache.keys[kid]) {
    return jwksCache.keys[kid];
  }
  let data;
  try {
    const res = await axios.get(jwksUrl);
    data = res.data;
  } catch (_) {
    return null;
  }
  const keys = Array.isArray(data.keys) ? data.keys : [];
  jwksCache.keys = {};
  keys.forEach(k => { if (k.kid && k.x5c && k.x5c[0]) jwksCache.keys[k.kid] = `-----BEGIN CERTIFICATE-----\n${k.x5c[0]}\n-----END CERTIFICATE-----\n`; });
  jwksCache.fetchedAt = now;
  return jwksCache.keys[kid] || null;
}

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication failed: No token provided.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    let decoded;
    if (process.env.AUTH_JWKS_URL) {
      // Verify via JWKS (RS256)
      decoded = await new Promise((resolve, reject) => {
        jwt.verify(
          token,
          async (header, cb) => {
            try {
              const cert = await getSigningKey(header.kid);
              if (!cert) return cb(new Error('Signing key not found'));
              cb(null, cert);
            } catch (e) { cb(e); }
          },
          {
            algorithms: ['RS256'],
            audience: process.env.AUTH_AUDIENCE || process.env.JWT_AUDIENCE || undefined,
            issuer: process.env.AUTH_ISSUER || process.env.JWT_ISSUER || undefined
          },
          (err, payload) => err ? reject(err) : resolve(payload)
        );
      });
    } else {
      // HMAC fallback
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    }
    req.user = decoded; 
    if (process.env.AUTH_DEBUG === '1') {
      console.log('✅ Token valid:', { id: decoded.id, type: decoded.type, exp: new Date(decoded.exp * 1000) });
    }
    next();
  } catch (error) {
    if (process.env.AUTH_DEBUG === '1') {
      console.log('❌ Token invalid:', { 
        error: error.message, 
        tokenPreview: token ? `${token.substring(0, 30)}...` : 'null',
        secretUsed: process.env.JWT_SECRET ? 'env var' : 'default',
        path: req.path 
      });
    }
    return res.status(401).json({ message: `Authentication failed: Invalid token. ${error.message}` });
  }
};

const authorize = (...allowedRoles) => {
  const normalizeRoleString = (value) => {
    if (!value) return '';
    let s = String(value).toLowerCase();
    // strip common prefixes
    s = s.replace(/^role[_:\-\s]?/, '');
    s = s.replace(/^scope[_:\-\s]?/, '');
    s = s.replace(/^urn:[^:]+:/, '');
    // compact separators
    s = s.replace(/[\s\-]+/g, '_');
    // singularize simple plurals
    if (s === 'drivers') s = 'driver';
    if (s === 'admins') s = 'admin';
    return s;
  };

  const allowed = (allowedRoles || []).map(r => normalizeRoleString(r));
  return (req, res, next) => {
    if (!req.user) return res.status(403).json({ message: 'Forbidden: No user information found.' });

    // DEBUG: Log token details for troubleshooting
    if (process.env.AUTH_DEBUG === '1') {
      console.log('🔍 Auth Debug:', {
        path: req.path,
        method: req.method,
        user: req.user,
        allowedRoles: allowedRoles,
        normalizedAllowed: allowed
      });
    }

    // Gather possible role/type claims from varied token shapes
    const candidateRoleFields = [];
    // roles array (objects or strings)
    if (Array.isArray(req.user.roles)) candidateRoleFields.push(...req.user.roles);
    // singular role string/object
    if (req.user.role) candidateRoleFields.push(req.user.role);
    // scope(s)
    if (Array.isArray(req.user.scopes)) candidateRoleFields.push(...req.user.scopes);
    if (typeof req.user.scope === 'string') candidateRoleFields.push(req.user.scope);
    // nested user objects from other services
    const nestedUser = req.user.user || req.user.account || req.user.data;
    if (nestedUser) {
      if (Array.isArray(nestedUser.roles)) candidateRoleFields.push(...nestedUser.roles);
      if (nestedUser.role) candidateRoleFields.push(nestedUser.role);
      if (Array.isArray(nestedUser.scopes)) candidateRoleFields.push(...nestedUser.scopes);
      if (typeof nestedUser.scope === 'string') candidateRoleFields.push(nestedUser.scope);
    }
    // comma/space separated strings in any of the above

    const normalizedUserRoles = candidateRoleFields
      .flatMap(r => {
        if (!r) return [];
        if (typeof r === 'string') return r.split(/[\s,]+/);
        if (r && r.name) return [r.name];
        return [];
      })
      .filter(Boolean)
      .map(r => normalizeRoleString(r));

    // various ways the user type might be stored
    const typeCandidatesRaw = [
      req.user.type,
      req.user.userType,
      req.user.accountType,
      nestedUser && (nestedUser.type || nestedUser.userType || nestedUser.accountType)
    ].filter(Boolean);
    const typeCandidates = typeCandidatesRaw.map(v => normalizeRoleString(v));

    if (process.env.AUTH_DEBUG === '1') {
      console.log('🔍 Role Analysis:', {
        candidateRoleFields,
        normalizedUserRoles,
        typeCandidatesRaw,
        typeCandidates,
        allowed,
        hasRoleMatch: normalizedUserRoles.some(r => allowed.includes(r)),
        hasTypeMatch: typeCandidates.some(t => allowed.includes(t))
      });
    }

    const isAuthorized =
      normalizedUserRoles.some(r => allowed.includes(r)) ||
      typeCandidates.some(t => allowed.includes(t));

    if (isAuthorized) {
      if (process.env.AUTH_DEBUG === '1') console.log('✅ Authorization granted');
      return next();
    }
    
    if (process.env.AUTH_DEBUG === '1') console.log('❌ Authorization denied');
    return res.status(403).json({ 
      message: `Forbidden: You do not have permission to access this resource. Required roles: ${allowedRoles.join(', ')}. Your roles: ${normalizedUserRoles.join(', ') || 'none'}. Your type: ${typeCandidates.join(', ') || 'none'}.`
    });
  };
};

module.exports = { authenticate, authorize };

