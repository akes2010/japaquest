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

// ── Analytics: 30-day trend, sources, funnel (own data only) ────────────────
router.get('/analytics', requireAuth, (req, res) => {
  const row = Q.getAffiliateByUserId(req.user.id) || (req.user.email ? Q.getAffiliateByEmail(req.user.email) : null);
  if (!row || (row.user_id && row.user_id !== req.user.id)) return res.status(404).json({ error: 'No affiliate application on file' });
  res.json({
    trend: Q.getAffiliateClickTrend(row.id, 30),
    sources: Q.getAffiliateClickSources(row.id, 30),
    funnel: Q.getAffiliateFunnel(row.id),
    self_blocked: !!row.self_blocked,
    note: row.note || '',
  });
});

// ── Posters: print-ready A4 + square social card, QR embedded server-side ───
const QR = require('qrcode');
const escH = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function posterHtml(row, appUrl, kind) {
  const link = `${appUrl}/r/${row.code}`;
  const qr = await QR.toDataURL(link, { width: kind === 'a4' ? 640 : 420, margin: 1, color: { dark: '#0A1428', light: '#F7F3EA' } });
  const rate = Math.round((parseFloat(Q.getSetting('affiliate_commission_rate')) || 0.30) * 100);
  const appName = Q.getSetting('app_name') || 'JapaQuest';
  const isA4 = kind === 'a4';
  const tagline = isA4 ? 'Visa answers · embassy-ready letters · honest budgets' : 'Your Journey. Our Intelligence.';
  const steps = isA4
    ? `<div class="steps"><span>1 · Scan</span><span>2 · Create account</span><span>3 · Plan your journey</span></div>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escH(appName)} — ${row.code}</title>
<style>
@page{size:${isA4 ? 'A4' : 'auto'};margin:${isA4 ? '0' : '0'}}
*{margin:0;box-sizing:border-box}
body{background:#F7F3EA;color:#0A1428;font-family:'Outfit',Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.poster{background:#F7F3EA;border:2px solid #0A1428;border-radius:24px;padding:${isA4 ? '54px 48px' : '34px'};text-align:center;max-width:${isA4 ? '760px' : '480px'};width:94%}
.kick{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#E8613C;border:1.5px solid #0A1428;border-radius:99px;padding:6px 16px;margin-bottom:${isA4 ? '26px' : '16px'};background:#fff}
h1{font-family:Georgia,serif;font-size:${isA4 ? '3rem' : '2rem'};line-height:1.1}
h1 em{font-style:italic;color:#E8613C}
.sub{font-size:${isA4 ? '1rem' : '.85rem'};color:rgba(10,20,40,.62);margin:12px auto ${isA4 ? '26px' : '18px'};max-width:520px;line-height:1.6}
.qr{background:#fff;border:2px solid #0A1428;border-radius:18px;padding:14px;display:inline-block}
.qr img{display:block;width:${isA4 ? '300px' : '200px'};height:${isA4 ? '300px' : '200px'}}
.code{font-family:Georgia,serif;font-size:${isA4 ? '1.5rem' : '1.15rem'};letter-spacing:.08em;margin:14px 0 4px}
.url{font-size:${isA4 ? '.85rem' : '.72rem'};color:rgba(10,20,40,.62);word-break:break-all}
.rate{margin-top:${isA4 ? '22px' : '14px'};font-size:${isA4 ? '.95rem' : '.8rem'};font-weight:600}
.steps{display:flex;gap:14px;justify-content:center;margin-top:${isA4 ? '20px' : '0'};font-size:.78rem;color:rgba(10,20,40,.62);flex-wrap:wrap}
.ft{margin-top:${isA4 ? '30px' : '18px'};font-size:.68rem;color:rgba(10,20,40,.5)}
@media print{body{background:#fff}.poster{border-width:2px}}
</style></head><body>
<div class="poster">
  <div class="kick">🤝 Partner: ${escH(row.org || row.name)}</div>
  <h1>Your journey abroad, <em>sorted.</em></h1>
  <p class="sub">${escH(tagline)} — start free with AI that knows your passport.</p>
  <div class="qr"><img src="${qr}" alt="QR code"/></div>
  <div class="code">${escH(row.code)}</div>
  <div class="url">${escH(link)}</div>
  ${steps}
  <div class="rate">Scan · Sign up · Plan — <strong>free to start</strong></div>
  <div class="ft">${escH(appName)}${isA4 ? ` · ${rate}% partner program` : ''} · ${escH(appUrl.replace(/^https?:\/\//, ''))}</div>
</div>
<script>if(new URLSearchParams(location.search).get('print')==='1')window.addEventListener('load',()=>window.print());</script>
</body></html>`;
}

router.get('/poster', requireAuth, async (req, res) => {
  try {
    const row = Q.getAffiliateByUserId(req.user.id) || (req.user.email ? Q.getAffiliateByEmail(req.user.email) : null);
    if (!row) return res.status(404).json({ error: 'No affiliate application on file' });
    const appUrl = (Q.getSetting('app_url') || process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const html = await posterHtml(row, appUrl, req.query.kind === 'a4' ? 'a4' : 'square');
    res.type('html').send(html);
  } catch (e) {
    console.error('[affiliate] poster failed:', e.message);
    res.status(500).json({ error: 'Could not build poster' });
  }
});

// Raw QR as PNG (for reuse in chat shares, emails, etc.)
router.get('/qr', requireAuth, async (req, res) => {
  const row = Q.getAffiliateByUserId(req.user.id) || (req.user.email ? Q.getAffiliateByEmail(req.user.email) : null);
  if (!row) return res.status(404).json({ error: 'No affiliate application on file' });
  const appUrl = (Q.getSetting('app_url') || process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const buf = await QR.toBuffer(`${appUrl}/r/${row.code}`, { width: 512, margin: 2, color: { dark: '#0A1428', light: '#F7F3EA' } });
  res.type('image/png').set('Cache-Control', 'public, max-age=3600').send(buf);
});

module.exports = router;
