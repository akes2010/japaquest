'use strict';
/**
 * Payment provider base — shared helpers for gateway modules.
 *
 * Each provider implements:
 *   key, displayName, fields (admin-config settings keys), docsUrl,
 *   isConfigured()        → bool (settings or env present)
 *   createCheckout({...}) → { redirectUrl } | { instructions } (manual gateways)
 *   verify webhook via registry.getWebhookSecret
 *
 * Secrets resolve from Admin → Payment Gateways settings first (DB),
 * falling back to .env — so the operator never edits code to go live.
 */
const https = require('https');
const crypto = require('crypto');
const { Q } = require('../db');

/** setting 'gw_<provider>_<field>' with env fallback. */
function cfg(provider, field, envName) {
  const v = Q.getSetting(`gw_${provider}_${field}`);
  if (v !== undefined && v !== null && v !== '') return v;
  return envName ? (process.env[envName] || '') : '';
}

function postJson(host, path, body, headers, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({ host, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }, timeout: timeoutMs }, r => {
      let buf = '';
      r.on('data', c => buf += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(buf || '{}') }); }
        catch { resolve({ status: r.statusCode, body: { raw: buf } }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('gateway timeout')); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Split "Major Unit ×100" — all gateways here take minor units (kobo/pesewas/cents).
const toMinor = usd => Math.round(Number(usd) * 100);

module.exports = { cfg, postJson, timingSafeEqual, toMinor };
