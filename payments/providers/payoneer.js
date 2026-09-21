'use strict';
/**
 * Payoneer — used mainly for AFFILIATE PAYOUTS (sending money out to
 * marketers worldwide), not for traveller checkout. Marked manual: the
 * admin settles payouts from the Payoneer dashboard, the app only records.
 */
module.exports = {
  key: 'payoneer',
  displayName: 'Payoneer',
  docsUrl: 'https://www.payoneer.com/docs',
  manual: true, // no hosted checkout — record-keeping only
  fields: [
    ['payee_id', 'Payoneer payee ID (your account)', false],
    ['program_id', 'Payouts program ID', false],
  ],
  envMap: { payee_id: 'PAYONEER_PAYEE_ID' },
  isConfigured() { return !!require('../base').cfg('payoneer', 'payee_id', 'PAYONEER_PAYEE_ID'); },
  currencies: ['USD', 'EUR', 'GBP'],

  // Manual gateways never create a checkout; the admin marks payouts sent.
  async createCheckout() {
    throw new Error('Payoneer is configured for payouts only — choose Paystack/Flutterwave/Stripe/OPay for plan checkout.');
  },
  verifyWebhook() { return false; },
  parseWebhook() { return null; },
};
