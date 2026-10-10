'use strict';
/** Paystack — cards, bank transfer, USSD across Africa. docs: paystack.com/docs */
const { cfg, postJson, timingSafeEqual, toMinor } = require('../base');
// NOTE: registry.js loads providers before exporting — destructure lazily
// inside verifyWebhook instead of at module load, or this stays undefined.

module.exports = {
  key: 'paystack',
  displayName: 'Paystack',
  docsUrl: 'https://paystack.com/docs',
  fields: [
    ['secret_key', 'Secret key (sk_live_… / sk_test_…)', true],
    ['public_key', 'Public key (pk_…)', false],
  ],
  envMap: { secret_key: 'PAYSTACK_SECRET_KEY', public_key: 'PAYSTACK_PUBLIC_KEY' },
  isConfigured() { return !!cfg('paystack', 'secret_key', 'PAYSTACK_SECRET_KEY'); },
  currencies: ['NGN', 'GHS', 'USD', 'ZAR', 'KES', 'XOF'],

  async createCheckout({ amountUsd, currency = 'NGN', email, reference, callbackUrl, metadata }) {
    const secret = cfg('paystack', 'secret_key', 'PAYSTACK_SECRET_KEY');
    const r = await postJson('api.paystack.co', '/transaction/initialize',
      { email, amount: toMinor(amountUsd), currency, reference, callback_url: callbackUrl, metadata },
      { Authorization: `Bearer ${secret}` });
    if (r.status === 200 && r.body.status && r.body.data?.authorization_url) {
      return { redirectUrl: r.body.data.authorization_url };
    }
    throw new Error(r.body.message || `Paystack init failed (${r.status})`);
  },

  // Paystack signature: HMAC-SHA512 of the raw body with the secret key.
  verifyWebhook(rawBody, signature) {
    const secret = cfg('paystack', 'secret_key', 'PAYSTACK_SECRET_KEY') || require('../registry').getWebhookSecret('paystack');
    if (!secret || !signature) return false;
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    return timingSafeEqual(expected, signature);
  },

  // Extract { reference, paid } from a verified webhook event.
  parseWebhook(event) {
    if (event.event === 'charge.success' && event.data?.reference) {
      return { reference: event.data.reference, paid: event.data.status === 'success', amount: (event.data.amount || 0) / 100 };
    }
    return null;
  },
};
