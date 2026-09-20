'use strict';
const jwt = require('jsonwebtoken');
const { Q } = require('../db');

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

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const payload = verifyToken(auth.slice(7));
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

module.exports = { signToken, verifyToken, requireAuth, requireAdmin };
