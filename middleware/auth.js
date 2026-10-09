'use strict';
const jwt = require('jsonwebtoken');
const { Q } = require('../db');

// Token sources, in priority order:
//   1. Authorization: Bearer <jwt>   — API clients / desktop pages
//   2. httpOnly cookie 'vg_session'  — set at login; keeps the credential out
//      of localStorage where any XSS payload could read it.

function SECRET() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (!SECRET._warned) {
    SECRET._warned = true;
    console.warn('⚠️  JWT_SECRET not set — using insecure default. Set it in .env before deploying!');
  }
  return 'visaguru-change-me-in-production';
}

function signToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, SECRET(), { expiresIn });
}

function verifyToken(token) {
  try { return jwt.verify(token, SECRET()); }
  catch { return null; }
}

function extractToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const c = req.cookies && req.cookies.vg_session;
  return typeof c === 'string' && c.length > 10 ? c : null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  const user = Q.getUserByUUID(payload.uuid);
  if (!user)   return res.status(401).json({ error: 'User not found' });
  if (user.status === 'banned') return res.status(403).json({ error: 'Account suspended. Contact support.' });

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

// Attaches req.user when a valid token is present; never blocks.
function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      const user = Q.getUserByUUID(payload.uuid);
      if (user && user.status !== 'banned') req.user = user;
    }
  }
  next();
}

module.exports = { signToken, verifyToken, requireAuth, requireAdmin, optionalAuth };
