'use strict';

/**
 * Payment gateway registry. Provider modules are optional — they are loaded
 * lazily so a missing/stub provider file can never crash the whole app.
 * See the provider shape documented below before adding one.
 */
const PROVIDER_NAMES = ['stripe', 'paystack', 'flutterwave', 'opay', 'payoneer', 'crypto'];

const PROVIDERS = {};
for (const name of PROVIDER_NAMES) {
  try {
    PROVIDERS[name] = require(`./providers/${name}`);
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e; // real bug — surface it
    // Provider not implemented yet; it simply won't be listed.
  }
}

/**
 * Adding a new gateway: implement the same shape in providers/<name>.js
 * (key, displayName, supportsRecurring, notes, isConfigured,
 *  createCheckout, verifyWebhookSignature, parseWebhookEvent). Nothing else
 * in the codebase needs to change — payments routes and the admin UI work
 * off this registry.
 */

function getProvider(key) {
  const provider = PROVIDERS[key];
  if (!provider) throw new Error(`Unknown payment provider: ${key}`);
  return provider;
}

function listProviders() {
  return Object.values(PROVIDERS);
}

/** Env var name each provider's webhook secret is expected under. */
const WEBHOOK_SECRET_ENV = {
  stripe: "STRIPE_WEBHOOK_SECRET",
  paystack: null, // signs webhooks with its secret key (cfg'd above), no separate hash
  flutterwave: "FLUTTERWAVE_WEBHOOK_SECRET_HASH",
  opay: null, // signs with SHA512 of the private key (read from cfg in opay.js)
  payoneer: null,
  crypto: null, // manual confirmation, no webhooks
};

// Webhook secrets resolve from Admin → Payment Gateways (DB setting
// `gw_<provider>_<field>`) first, falling back to .env — mirrors base.cfg's
// precedence so operators who only use the admin panel still go live.
function getWebhookSecret(key) {
  const envVar = WEBHOOK_SECRET_ENV[key];
  const fromEnv = envVar ? (process.env[envVar] || '') : '';
  if (fromEnv) return fromEnv;
  try {
    const { Q } = require('../db');
    return Q.getSetting(`gw_${key}_webhook_secret`) || Q.getSetting(`gw_${key}_webhook_hash`) || '';
  } catch { return ''; }
}

module.exports = { getProvider, listProviders, getWebhookSecret, PROVIDERS };
