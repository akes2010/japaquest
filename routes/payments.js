'use strict';
/**
 * Payments routes — plan checkout + webhook receiver.
 *
 * POST /api/payments/checkout  { plan_id, provider, coin? }  (auth) →
 *   automatic gateways: { redirectUrl }  (traveller completes on the gateway)
 *   manual (crypto):    { instructions } (send + submit tx hash)
 * POST /api/payments/webhooks/:provider          (public, signature-verified)
 * POST /api/payments/:reference/tx               { tx_hash } (crypto submit)
 * GET  /api/payments/mine                        (auth)
 * Admin confirm/reject of manual payments lives in routes/admin.js.
 */
const router = require('express').Router();
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/auth');
const { Q, persist } = require('../db');
const registry = require('../payments/registry');

function appUrl() {
  return (Q.getSetting('app_url') || process.env.APP_URL || 'http://localhost:4001').replace(/\/$/, '');
}
function newRef() { return 'JQP-' + crypto.randomBytes(6).toString('hex').toUpperCase(); }

// Commission rate for affiliates (Admin → Payment Gateways can override).
function commissionRate() {
  const v = parseFloat(Q.getSetting('affiliate_commission_rate'));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.30;
}

/** Settle a paid payment: upgrade plan + credit the affiliate. */
function settlePayment(payment) {
  if (payment.status !== 'pending') return;
  Q.markPaymentPaid(payment.id);
  // Upgrade the traveller's plan (highest plan wins via plan_id).
  if (payment.plan_id && payment.user_id) {
    try { Q.execRaw('UPDATE users SET plan_id=?,updated_at=datetime(\'now\') WHERE id=?', [payment.plan_id, payment.user_id]); } catch (e) { console.error('[payments] plan upgrade failed:', e.message); }
  }
  // Affiliate commission — only for approved marketers with a stored code.
  if (payment.affiliate_code) {
    const aff = Q.getAffiliateByCode(payment.affiliate_code);
    if (aff && aff.status === 'approved') {
      const commission = Math.round(payment.amount_usd * commissionRate() * 100) / 100;
      if (commission > 0) {
        Q.addAffiliateCredit(aff.id, payment.user_id, payment.id, payment.amount_usd, commission, `Plan payment ${payment.reference}`);
        try {
          const { createNotification } = Q;
          createNotification(payment.user_id, '💸 Payment confirmed', 'Your plan is active. Welcome aboard!', 'success');
        } catch {}
      }
    }
  }
}

router.get('/config', requireAuth, (_req, res) => {
  const providers = registry.listProviders()
    .filter(p => !p.manual)
    .map(p => ({ key: p.key, displayName: p.displayName, configured: p.isConfigured(), currencies: p.currencies || [] }));
  const cryptoP = registry.PROVIDERS.crypto;
  res.json({
    providers,
    crypto: cryptoP ? {
      configured: cryptoP.isConfigured(),
      coins: cryptoP.isConfigured() ? cryptoP.coins.map(c => ({ id: c.id, label: c.label })) : [],
    } : null,
  });
});

// ── Create checkout ──────────────────────────────────────────────────────────
router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const { plan_id, provider: provKey, coin } = req.body || {};
    const plan = Q.getPlanById(parseInt(plan_id));
    if (!plan || !plan.price || plan.price <= 0) return res.status(400).json({ error: 'Invalid or free plan' });
    const provider = registry.getProvider(provKey);
    if (!provider || provider.manual && provKey !== 'crypto') return res.status(400).json({ error: 'Provider unavailable' });
    if (!provider.isConfigured()) return res.status(400).json({ error: `${provider.displayName} is not configured yet — contact support` });

    const reference = newRef();
    const payment = { id: Q.createPayment(req.user.id, plan.id, provKey, plan.price, reference, req.user.referred_by || '') };

    const result = await provider.createCheckout({
      amountUsd: plan.price, currency: provKey === 'paystack' ? 'NGN' : 'USD',
      email: req.user.email, name: req.user.name, reference,
      callbackUrl: `${appUrl()}/dashboard#sub`,
      coinId: coin, planName: plan.name,
      metadata: { userId: req.user.id, planId: plan.id },
    });

    if (result.redirectUrl) return res.json({ redirectUrl: result.redirectUrl, reference });
    if (result.instructions) {
      res.json({ instructions: result.instructions, reference });
      return;
    }
    throw new Error('Gateway returned no checkout target');
  } catch (e) {
    console.error('[payments] checkout failed:', e.message);
    res.status(502).json({ error: e.message || 'Payment initialisation failed' });
  }
});

// ── Webhook receiver (public; signature-verified per provider) ───────────────
router.post('/webhooks/:provider', (req, res) => {
  const provKey = String(req.params.provider);
  let provider;
  try { provider = registry.getProvider(provKey); } catch { return res.status(404).json({ error: 'Unknown provider' }); }
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const sig = req.headers['x-paystack-signature'] || req.headers['verif-hash'] || req.headers['stripe-signature'] || req.headers['x-opay-signature'] || '';
  try {
    if (!provider.verifyWebhook(raw, sig)) return res.status(401).json({ error: 'Invalid signature' });
    const parsed = provider.parseWebhook(JSON.parse(raw));
    if (parsed && parsed.paid && parsed.reference) {
      const payment = Q.getPaymentByReference(parsed.reference);
      if (payment) settlePayment(payment);
      persist();
      return res.json({ received: true });
    }
    res.json({ ignored: true });
  } catch (e) {
    console.error(`[payments] webhook ${provKey} error:`, e.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ── Crypto: traveller submits tx hash after sending ──────────────────────────
router.post('/:reference/tx', requireAuth, (req, res) => {
  const payment = Q.getPaymentByReference(String(req.params.reference));
  if (!payment || payment.user_id !== req.user.id) return res.status(404).json({ error: 'Payment not found' });
  if (payment.provider !== 'crypto') return res.status(400).json({ error: 'Not a crypto payment' });
  const tx = String((req.body || {}).tx_hash || '').trim().slice(0, 120);
  if (!tx) return res.status(400).json({ error: 'tx_hash required' });
  const meta = JSON.parse(payment.meta_json || '{}');
  meta.tx_hash = tx;
  Q.execRaw('UPDATE payments SET meta_json=? WHERE id=?', [JSON.stringify(meta), payment.id]);
  res.json({ message: 'Transaction submitted — we confirm crypto payments manually, usually within a few hours.' });
});

// ── Traveller's payment history ──────────────────────────────────────────────
router.get('/mine', requireAuth, (req, res) => {
  res.json({ payments: Q.getUserPayments(req.user.id) });
});

module.exports = router;
module.exports.settlePayment = settlePayment;
module.exports.commissionRate = commissionRate;
