'use strict';
/**
 * Affiliate routes — the marketer-facing side of the program.
 *
 * POST /api/affiliate/apply    (public)  { name, email, org }   → pending + code
 * GET  /api/affiliate/me       (auth, own affiliate row + stats)
 * POST /api/affiliate/payout   (auth)    { method, account }     → save payout acct
 *
 * Commission is credited by routes/payments.js when a referred user pays.
 */
const router = require('express').Router();
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { Q } = require('../db');
const { sendEmail } = require('../utils/mailer');

const PAYOUT_METHODS = ['payoneer', 'bank_transfer', 'crypto_usdt', 'crypto_btc', 'opay', 'mobile_money'];

// ── Apply (public — individuals and organisations) ───────────────────────────
router.post('/apply', optionalAuth, async (req, res) => {
  try {
    const { name, org } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name or organisation name is required' });
    // Logged-in applicants use their account email; public applicants must supply one.
    const em = String(req.user ? req.user.email : (req.body || {}).email || '').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return res.status(400).json({ error: 'Valid email required' });
    if (Q.getAffiliateByEmail(em)) return res.status(409).json({ error: 'This email already applied — check your inbox for your tracking code' });

    const userId = req.user ? req.user.id : null;
    const id = Q.createAffiliate({ name: String(name).trim().slice(0, 120), email: em, org: String(org || '').trim().slice(0, 160), userId });
    const aff = Q.getAffiliateById(id);

    // Notify the operator (best-effort) + email the applicant their code.
    try {
      const support = Q.getSetting('concierge_notify_email') || Q.getSetting('support_email');
      if (support) sendEmail({ to: support, subject: `🤝 New affiliate application — ${aff.name}`, html: `<p><strong>${aff.name}</strong> (${aff.org || 'individual'}) applied with email ${aff.email}. Tracking code: <strong>${aff.code}</strong>. Approve it in Admin → Affiliates.</p>` }).catch(() => {});
      sendEmail({
        to: aff.email,
        subject: `Your JapaQuest tracking code: ${aff.code}`,
        html: `<h2>Welcome aboard, ${aff.name}!</h2><p>Your tracking code is <strong style="font-size:1.2em">${aff.code}</strong>.</p><p>Share links like <code>${(Q.getSetting('app_url') || process.env.APP_URL || 'https://japaquest.com').replace(/\/$/, '')}/r/${aff.code}</code> — you earn <strong>30%</strong> of every paid plan bought by travellers who sign up through your link.</p><p>Your links start earning once we approve your application (usually within 24h). Track clicks and earnings any time at <code>/dashboard#earnings</code>.</p>`,
      }).catch(() => {});
    } catch {}

    res.status(201).json({ code: aff.code, message: 'Application received — your tracking code is ready. It starts earning once approved (usually within 24h).' });
  } catch (e) {
    console.error('[affiliate] apply failed:', e.message);
    res.status(500).json({ error: 'Could not process application' });
  }
});

// ── My affiliate dashboard (auth) ────────────────────────────────────────────
router.get('/me', optionalAuth, requireAuth, (req, res) => {
  const row = req.user.email ? Q.getAffiliateByEmail(req.user.email) : null;
  if (!row) return res.json({ enrolled: false });
  const balanceMinor = Q.affiliateBalanceMinor(row.id);
  res.json({
    enrolled: true,
    id: row.id, code: row.code, status: row.status, org: row.org,
    clicks: row.clicks, signups: row.signups, conversions: row.conversions,
    earned: row.earned_minor / 100, paid: row.paid_minor / 100,
    balance: balanceMinor / 100,
    payoutMethod: row.payout_method, payoutAccount: row.payout_account,
    credits: Q.getAffiliateCredits(row.id, 20).map(c => ({ amount: c.amount_usd, commission: c.commission_usd, status: c.status, note: c.note, at: c.created_at })),
    link: `${(Q.getSetting('app_url') || process.env.APP_URL || '').replace(/\/$/, '')}/r/${row.code}`,
  });
});

// ── Save payout account ──────────────────────────────────────────────────────
router.post('/payout', requireAuth, (req, res) => {
  // Address by user id first (owner lookup); fall back to email match for
  // affiliates who applied publicly before creating an account.
  let row = Q.getAffiliateByUserId(req.user.id);
  if (!row) row = req.user.email ? Q.getAffiliateByEmail(req.user.email) : null;
  if (!row || (row.user_id && row.user_id !== req.user.id)) return res.status(404).json({ error: 'No affiliate application on file' });
  const { method, account } = req.body || {};
  if (!PAYOUT_METHODS.includes(method)) return res.status(400).json({ error: 'Unsupported payout method' });
  if (!account || !String(account).trim()) return res.status(400).json({ error: 'Payout account details required' });
  Q.setAffiliatePayout(row.id, method, String(account).trim().slice(0, 300));
  res.json({ message: 'Payout account saved' });
});

// Get current user's referral code easily (for sharing UI even before approval)
router.get('/ref-code', requireAuth, (req, res) => {
  const row = Q.getAffiliateByEmail(req.user.email);
  res.json({ code: row ? row.code : null, status: row ? row.status : null });
});

module.exports = router;
