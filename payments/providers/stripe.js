'use strict';
/** Stripe — international cards + wallets. docs: stripe.com/docs */
const { cfg, postJson, timingSafeEqual, toMinor } = require('../base');
const { getWebhookSecret } = require('../registry');

module.exports = {
  key: 'stripe',
  displayName: 'Stripe',
  docsUrl: 'https://stripe.com/docs/payments/checkout',
  fields: [
    ['secret_key', 'Secret key (sk_live_… / sk_test_…)', true],
    ['public_key', 'Publishable key (pk_…)', false],
    ['webhook_secret', 'Webhook signing secret (whsec_…)', false],
  ],
  envMap: { secret_key: 'STRIPE_SECRET_KEY' },
  isConfigured() { return !!cfg('stripe', 'secret_key', 'STRIPE_SECRET_KEY'); },
  currencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'],

  // Stripe Checkout Session via form-encoded API (no SDK needed).
  async createCheckout({ amountUsd, currency = 'USD', email, reference, callbackUrl, planName }) {
    const secret = cfg('stripe', 'secret_key', 'STRIPE_SECRET_KEY');
    const params = new URLSearchParams({
      mode: 'payment',
      'payment_method_types[0]': 'card',
      customer_email: email,
      client_reference_id: reference,
      success_url: callbackUrl,
      cancel_url: callbackUrl + '?cancelled=1',
      'line_items[0][price_data][currency]': currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(toMinor(amountUsd)),
      'line_items[0][price_data][product_data][name]': planName || 'JapaQuest plan',
      'line_items[0][quantity]': '1',
    });
    const data = params.toString();
    const r = await new Promise((resolve, reject) => {
      const req = require('https').request({ host: 'api.stripe.com', path: '/v1/checkout/sessions', method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } },
        resp => { let b = ''; resp.on('data', c => b += c); resp.on('end', () => { try { resolve({ status: resp.statusCode, body: JSON.parse(b) }); } catch { resolve({ status: resp.statusCode, body: {} }); } }); });
      req.on('error', reject); req.write(data); req.end();
    });
    if (r.status === 200 && r.body.url) return { redirectUrl: r.body.url };
    throw new Error(r.body.error?.message || `Stripe init failed (${r.status})`);
  },

  // Stripe: HMAC-SHA256 over "t=<ts>,v1=<sig>" scheme — implement the check
  // against the raw body + Stripe-Signature header.
  verifyWebhook(rawBody, signature) {
    const secret = cfg('stripe', 'webhook_secret', 'STRIPE_WEBHOOK_SECRET') || getWebhookSecret('stripe');
    if (!secret || !signature) return false;
    const parts = Object.fromEntries(String(signature).split(',').map(p => p.split('=')));
    if (!parts.t || !parts.v1) return false;
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
    return timingSafeEqual(expected, parts.v1);
  },

  parseWebhook(event) {
    if (event.type === 'checkout.session.completed' && event.data?.object) {
      const s = event.data.object;
      return { reference: s.client_reference_id || s.id, paid: s.payment_status === 'paid', amount: (s.amount_total || 0) / 100 };
    }
    return null;
  },
};
