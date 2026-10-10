'use strict';
/** Flutterwave — pan-African gateway (cards, mobile money, bank). docs: developer.flutterwave.com */
const { cfg, postJson, timingSafeEqual, toMinor } = require('../base');
const { getWebhookSecret } = require('../registry');

module.exports = {
  key: 'flutterwave',
  displayName: 'Flutterwave',
  docsUrl: 'https://developer.flutterwave.com/docs',
  fields: [
    ['secret_key', 'Secret key (FLWSECK-…)', true],
    ['public_key', 'Public key (FLWPUBK-…)', false],
    ['encryption_key', 'Encryption key', false],
    ['webhook_hash', 'Webhook secret hash (verif-hash you set in your Flutterwave dashboard)', false],
  ],
  envMap: { secret_key: 'FLUTTERWAVE_SECRET_KEY', public_key: 'FLUTTERWAVE_PUBLIC_KEY' },
  isConfigured() { return !!cfg('flutterwave', 'secret_key', 'FLUTTERWAVE_SECRET_KEY'); },
  currencies: ['NGN', 'GHS', 'KES', 'ZAR', 'XOF', 'XAF', 'UGX', 'TZS', 'USD', 'EUR', 'GBP'],

  async createCheckout({ amountUsd, currency = 'NGN', email, reference, callbackUrl, metadata, name }) {
    const secret = cfg('flutterwave', 'secret_key', 'FLUTTERWAVE_SECRET_KEY');
    const r = await postJson('api.flutterwave.com', '/v3/payments',
      {
        tx_ref: reference, amount: amountUsd, currency, payment_options: 'card,banktransfer,ussd',
        customer: { email, name: name || email },
        customizations: { title: 'JapaQuest', description: 'Plan upgrade' },
        redirect_url: callbackUrl, meta: metadata,
      },
      { Authorization: `Bearer ${secret}` });
    if (r.status === 200 && r.body.status === 'success' && r.body.data?.link) {
      return { redirectUrl: r.body.data.link };
    }
    throw new Error(r.body.message || `Flutterwave init failed (${r.status})`);
  },

  // Flutterwave signs with verif-hash (any string you set) — compare constant-time.
  verifyWebhook(rawBody, signature) {
    const secret = process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH || cfg('flutterwave', 'webhook_hash', 'FLUTTERWAVE_WEBHOOK_SECRET_HASH');
    if (!secret || !signature) return false;
    return timingSafeEqual(secret, signature);
  },

  parseWebhook(event) {
    if (event.event === 'charge.completed' && event.data?.tx_ref) {
      return { reference: event.data.tx_ref, paid: event.data.status === 'successful', amount: event.data.amount };
    }
    return null;
  },
};
