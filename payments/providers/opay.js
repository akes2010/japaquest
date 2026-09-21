'use strict';
/** OPay — Nigeria mobile-money merchant gateway. docs: docs.opayweb.com */
const { cfg, postJson, timingSafeEqual, toMinor } = require('../base');

module.exports = {
  key: 'opay',
  displayName: 'OPay Merchant',
  docsUrl: 'https://docs.opayweb.com',
  fields: [
    ['merchant_id', 'Merchant ID', true],
    ['public_key', 'Public key', true],
    ['private_key', 'Private key (secret)', true],
  ],
  envMap: { merchant_id: 'OPAY_MERCHANT_ID', public_key: 'OPAY_PUBLIC_KEY', private_key: 'OPAY_SECRET_KEY' },
  isConfigured() { return !!cfg('opay', 'merchant_id', 'OPAY_MERCHANT_ID') && !!cfg('opay', 'private_key', 'OPAY_SECRET_KEY'); },
  currencies: ['NGN'],

  async createCheckout({ amountUsd, currency = 'NGN', email, reference, callbackUrl, name }) {
    // NOTE: confirm the exact endpoint/fields against OPay's current docs —
    // this targets the standard /api/v3/transaction/create flow.
    const r = await postJson('cashierapi.opayweb.com', '/api/v3/transaction/create',
      {
        merchantId: cfg('opay', 'merchant_id', 'OPAY_MERCHANT_ID'),
        reference, amount: toMinor(amountUsd), currency,
        userInfo: { userEmail: email, userName: name || email },
        callbackUrl, payMethod: 'QMWALLET',
      },
      { Authorization: `Bearer ${cfg('opay', 'private_key', 'OPAY_SECRET_KEY')}` });
    if (r.status === 200 && r.body.data?.cashierUrl) return { redirectUrl: r.body.data.cashierUrl };
    throw new Error(r.body.message || `OPay init failed (${r.status})`);
  },

  // OPay signs webhooks with SHA512 over raw body + private key.
  verifyWebhook(rawBody, signature) {
    const crypto = require('crypto');
    const secret = cfg('opay', 'private_key', 'OPAY_SECRET_KEY');
    if (!secret || !signature) return false;
    const expected = crypto.createHash('sha512').update(rawBody + secret).digest('hex');
    return timingSafeEqual(expected, signature);
  },

  parseWebhook(event) {
    const d = event.data || event;
    if (d.reference) return { reference: d.reference, paid: d.status === 'SUCCESS' || d.status === 'success', amount: (d.amount || 0) / 100 };
    return null;
  },
};
