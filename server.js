'use strict';
require('dotenv').config();
const express  = require('express');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const compress = require('compression');
const rateLimit= require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { initDB, Q, persist, DB_PATH, quickCheck } = require('./db');
const BRAND = require('./config/brand');
const geo = require('./utils/geo');
const fx = require('./utils/fx');
const i18n = require('./utils/i18n');

const app = express();

// ── GEO / FX / LOCALE ─────────────────────────────────────────────────────
// Attach req.geo (country, flag, currency, languages) + req.lang to every
// request. Cheap: CDN header → IP cache → default; live IP lookup happens
// lazily in /api/geo, never blocking normal requests.
app.use((req, _res, next) => {
  req.geo = geo.detectSync(req);
  req.lang = i18n.negotiate({ acceptLanguage: req.headers['accept-language'], geoLanguages: req.geo.languages });
  next();
});

// ── AFFILIATE REF TRACKING ─────────────────────────────────────────────────
// /r/CODE → landing with ?ref=CODE + 30-day cookie. Also honours ?ref= on any
// page so marketers can share plain links. Never blocks the request.
app.get('/r/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase().slice(0, 24);
  if (/^JQ[0-9A-Z]{4,12}$/.test(code)) {
    res.cookie('refcookie', code, { maxAge: 30 * 24 * 3600 * 1000, sameSite: 'lax', path: '/' });
    try {
      const a = require('./db').Q.getAffiliateByCode(code);
      if (a) {
        const src = String(req.query.s || req.query.utm_source || 'direct').slice(0, 24);
        const iph = crypto.createHash('sha256').update((req.ip || '') + 'affclick').digest('hex').slice(0, 16);
        require('./db').Q.recordAffiliateClick(a.id, src, iph);
      }
    } catch {}
    // _r=1 marks our own redirect so the ?ref= middleware never double-counts.
    return res.redirect('/?ref=' + encodeURIComponent(code) + '&_r=1');
  }
  res.redirect('/');
});
app.use((req, res, next) => {
  const ref = String(req.query.ref || '').toUpperCase().slice(0, 24);
  if (/^JQ[0-9A-Z]{4,12}$/.test(ref) && req.query._r !== '1' && !req.cookies?.refcookie) {
    res.cookie('refcookie', ref, { maxAge: 30 * 24 * 3600 * 1000, sameSite: 'lax', path: '/' });
    try {
      const a = require('./db').Q.getAffiliateByCode(ref);
      if (a) {
        const src = String(req.query.s || req.query.utm_source || 'direct').slice(0, 24);
        const iph = crypto.createHash('sha256').update((req.ip || '') + 'affclick').digest('hex').slice(0, 16);
        require('./db').Q.recordAffiliateClick(a.id, src, iph);
      }
    } catch {}
  }
  next();
});

// ── SECURITY ──────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:       ["'self'", "https://fonts.gstatic.com", "https://fonts.googleapis.com"],
      connectSrc:    ["'self'", "https://api.anthropic.com", "https://openrouter.ai",
                      "https://api.groq.com", "https://generativelanguage.googleapis.com",
                      "https://api.together.xyz", "https://api.deepseek.com",
                      "https://api-inference.huggingface.co", "https://test.api.amadeus.com",
                      "https://api.amadeus.com"],
      imgSrc:        ["'self'", "data:", "https:", "blob:"],
      objectSrc:     ["'none'"],
      baseUri:       ["'self'"],
      frameAncestors:["'self'"],
    },
  },
}));
app.use(cors({ origin: true, credentials: true }));
// Behind cPanel/Truehost's nginx proxy (and any CDN), X-Forwarded-For carries
// the real client IP. Without this, express-rate-limit buckets ALL visitors
// under the proxy IP and 429s the whole site once 300 requests arrive.
app.set('trust proxy', 1);
app.use(compress());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs:15*60*1000, max:300, standardHeaders:true, legacyHeaders:false }));

// ── STATIC FILES ──────────────────────────────────────────────────────────────
app.use('/icons',   express.static(path.join(__dirname,'public','icons'),   {maxAge:'30d',immutable:true}));
app.use('/uploads', express.static(path.join(__dirname,'public','uploads'), {maxAge:'7d'}));
app.use(express.static(path.join(__dirname,'public'), {maxAge:0}));

// ── SERVICE WORKER ────────────────────────────────────────────────────────────
app.get('/sw.js', (_req,res) => { res.setHeader('Service-Worker-Allowed','/'); res.setHeader('Cache-Control','no-cache'); res.sendFile(path.join(__dirname,'public','sw.js')); });
app.get('/manifest.json', (_req,res) => { res.setHeader('Cache-Control','public,max-age=86400'); res.sendFile(path.join(__dirname,'public','manifest.json')); });

// ── APP INFO ──────────────────────────────────────────────────────────────────
app.get('/api/app-info', (_req,res) => res.json({
  name:        Q.getSetting('app_name')    || BRAND.NAME,
  tagline:     Q.getSetting('app_tagline') || BRAND.TAGLINE,
  logo:        Q.getSetting('app_logo')    || '✈',
  logoUrl:     Q.getSetting('app_logo_url')|| '',
  supportEmail:Q.getSetting('support_email')|| '',
  maintenance: Q.getSetting('maintenance_mode')==='1',
  regOpen:     Q.getSetting('registration_open')!=='0',
  suite:       BRAND.SUITE,
}));

// ── HEALTH CHECK (uptime monitors; bypasses maintenance + needs no auth) ─────
app.get('/api/health', async (_req,res) => {
  const t0 = Date.now();
  let db = 'down';
  try { Q.getSetting('app_name'); db = 'ok'; } catch {}
  const journey = require('./worker/journey-scheduler').status();
  const social  = require('./worker/social-scheduler').status();
  const now = Date.now();
  const stale = ts => !ts || (now - new Date(ts).getTime()) > 10 * 60 * 1000; // >10 min = stale
  // Integrity: file size, core-table row counts and a PRAGMA quick_check.
  // Uptime monitors can alert on integrity.status != 'ok' or users dropping
  // to 0 — that pattern is how a wiped/corrupt database announces itself.
  let integrity = { status: 'unknown' };
  if (db === 'ok') {
    try {
      const counts = {};
      let empty = false;
      for (const k of ['users', 'payments', 'conversations']) {
        const c = (Q.queryAllSafe(`SELECT COUNT(*) AS c FROM ${k}`)[0] || {}).c || 0;
        counts[k] = c;
        // A wiped database always shows users=0 (seed creates an admin on
        // first boot). Zero payments/conversations is normal on a new install.
        if (k === 'users' && c === 0) empty = true;
      }
      const check = quickCheck();
      let bytes = null;
      try { bytes = fs.statSync(DB_PATH).size; } catch {}
      integrity = {
        status: check === 'ok' && !empty ? 'ok' : (check === 'ok' ? 'suspicious' : 'corrupt'),
        db_bytes: bytes,
        row_counts: counts,
        quick_check: check,
      };
    } catch (e) {
      integrity = { status: 'corrupt', error: e.message };
    }
  }
  res.json({
    status: db === 'ok' ? 'ok' : 'degraded',
    uptime_sec: Math.floor(process.uptime()),
    db,
    db_latency_ms: Date.now() - t0,
    integrity,
    schedulers: {
      journey: { ...journey, stale: journey.lastRunAt ? stale(journey.lastRunAt) : null },
      social:  { ...social,  stale: social.lastRunAt  ? stale(social.lastRunAt)  : null },
    },
    version: require('./package.json').version,
    time: new Date().toISOString(),
  });
});

// ── MAINTENANCE ───────────────────────────────────────────────────────────────
// NOTE: mounted under /api/, so req.path is relative — '/app-info', not '/api/app-info'
app.use('/api/', (req,res,next) => {
  if (Q.getSetting('maintenance_mode')==='1' && !req.headers.authorization && req.path!=='/app-info') {
    return res.status(503).json({error:'Under maintenance. Please check back shortly.'});
  }
  next();
});

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/ai',     require('./routes/ai'));
app.use('/api/user',   require('./routes/user'));
app.use('/api/admin',  require('./routes/admin'));
app.use('/api/travel', require('./routes/travel'));
app.use('/api/journey', require('./routes/journey'));
app.use('/api/visa',   require('./routes/visa-db'));
app.use('/api/chat',   require('./routes/chat'));
app.use('/api/concierge', require('./routes/concierge'));
app.use('/api/geo', require('./routes/geo'));
app.use('/api/affiliate', require('./routes/affiliate'));
app.use('/api/payments', require('./routes/payments'));

// ── CRON TICK (for shared hosting without persistent workers) ────────────────
// Truehost-style cPanel cron: curl -s "https://yourdomain.com/api/cron/tick?key=CRON_SECRET"
// Runs both schedulers on demand instead of relying on long-lived intervals.
app.get('/api/cron/tick', async (req, res) => {
  const secret = process.env.CRON_SECRET || Q.getSetting('cron_secret') || '';
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET not configured' });
  const provided = req.query.key || String(req.headers['x-cron-key'] || '');
  if (provided !== secret) return res.status(401).json({ error: 'Invalid cron key' });
  try {
    const [social, journey] = await Promise.all([
      require('./worker/social-scheduler').runOnce(),
      require('./worker/journey-scheduler').runOnce(),
    ]);
    persist();
    res.json({ ok: true, ran_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: 'Tick failed: ' + e.message });
  }
});

// ── CRON: DB BACKUP (for shared hosting without shell/sqlite3 access) ──────
// sql.js keeps the whole DB in memory, so the only corruption-proof snapshot
// is the exact in-memory state: flush it, then send the file. Point cPanel's
// Cron Jobs at it — e.g. nightly:
//   curl -s "https://site.com/api/cron/backup?key=CRON_SECRET" \
//     -o ~/backups/japaquest-$(date +\%Y\%m\%d).db
// X-Row-Counts lets the cron log flag a wiped/corrupt DB before it overwrites
// a good backup (e.g. users=0 means stop and restore).
app.get('/api/cron/backup', (req, res) => {
  const secret = process.env.CRON_SECRET || Q.getSetting('cron_secret') || '';
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET not configured' });
  const provided = req.query.key || String(req.headers['x-cron-key'] || '');
  if (provided !== secret) return res.status(401).json({ error: 'Invalid cron key' });
  try { persist(); } catch (e) { return res.status(500).json({ error: 'Flush failed: ' + e.message }); }
  try {
    const buf = fs.readFileSync(DB_PATH);
    if (!buf || !buf.length) throw new Error('database file is empty');
    const n = k => (Q.queryAllSafe(`SELECT COUNT(*) AS c FROM ${k}`)[0] || {}).c || 0;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="jagaguru-${new Date().toISOString().slice(0, 10)}.db"`);
    res.setHeader('X-DB-Bytes', String(buf.length));
    res.setHeader('X-Row-Counts', `users=${n('users')};payments=${n('payments')};conversations=${n('conversations')}`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: 'Backup failed: ' + e.message });
  }
});

// ── API 404 ───────────────────────────────────────────────────────────────────
// Unknown API endpoints must return JSON 404, never the SPA fallback below.
app.use('/api', (_req,res) => res.status(404).json({ error: 'Endpoint not found' }));

// ── SUITE LANDING PAGES (server-rendered from config/brand.js) ───────────────
const esc5 = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
app.get('/suite',        (_req,res) => res.redirect('/#suite'));
app.get('/suite/:key', (req,res) => {
  const p = BRAND.SUITE.find(x => x.key === req.params.key);
  if (!p) return res.redirect('/#suite');
  const others = BRAND.SUITE.filter(x => x.key !== p.key);
  // Server-side i18n: ?lang= > cookie > Accept-Language > geo languages.
  const L = i18n.negotiate({
    pref: req.query.lang || (req.headers.cookie || '').match(/vg_lang=([a-z]{2})/i)?.[1] || '',
    acceptLanguage: req.headers['accept-language'],
    geoLanguages: req.geo ? req.geo.languages : ['en'],
  });
  const T = k => i18n.t(L, k);
  const dirAttr = i18n.RTL.has(L) ? ' dir="rtl"' : '';
  const feats = p.features.map(([ic,t,d]) => `
      <div class="f-card"><div class="f-ic">${ic}</div><div><div class="f-t">${esc5(t)}</div><p>${esc5(d)}</p></div></div>`).join('');
  const nav = others.map(o => `<a class="pl" href="/suite/${o.key}${req.query.lang ? '?lang='+encodeURIComponent(req.query.lang) : ''}">${o.icon} ${esc5(o.name)}</a>`).join('');
  const langOpts = i18n.LANGUAGES.map(l => `<option value="${l.code}"${l.code===L?' selected':''}>${l.flag} ${l.name}</option>`).join('');
  res.send(`<!DOCTYPE html><html lang="${L}"${dirAttr}><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc5(p.name)} — ${esc5(p.short)} | ${esc5(BRAND.NAME)}</title>
<meta name="description" content="${esc5(p.desc)}"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet"/>
<style>
:root{--paper:#F7F3EA;--ink:#0A1428;--accent:#E8613C;--mut:rgba(10,20,40,.62);--line:rgba(10,20,40,.12);--fd:Fraunces,Georgia,serif;--fb:Outfit,Segoe UI,sans-serif}
*{margin:0;box-sizing:border-box}body{background:var(--paper);color:var(--ink);font-family:var(--fb)}
a{text-decoration:none;color:inherit}.wrap{max-width:1060px;margin:0 auto;padding:0 22px}
nav{display:flex;justify-content:space-between;align-items:center;padding:20px 0;border-bottom:1px solid var(--line)}
.logo{display:flex;align-items:center;gap:9px;font-family:var(--fd);font-weight:700;font-size:1.06rem}
.logo-mark{width:34px;height:34px;border-radius:10px;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;font-size:1rem}
.logo-quest{color:var(--accent)}
.top-link{font-size:.82rem;color:var(--mut)}
.hero{padding:64px 0 40px}.kick{display:inline-block;font-size:.72rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);border:1px solid var(--line);border-radius:99px;padding:6px 14px;margin-bottom:20px;background:#fff}
h1{font-family:var(--fd);font-size:clamp(2rem,4.6vw,3.1rem);line-height:1.12;font-weight:700}
h1 em{font-style:italic;color:var(--accent)}
.sub{margin:16px 0 26px;font-size:1.02rem;color:var(--mut);max-width:640px;line-height:1.7}
.btn{display:inline-block;border-radius:99px;padding:13px 28px;font-weight:600;font-size:.92rem;font-family:var(--fb);border:none;cursor:pointer;transition:transform .3s cubic-bezier(.22,1,.36,1)}
.btn-acc{background:var(--accent);color:#fff}.btn-line{border:1.5px solid var(--ink);color:var(--ink);background:transparent;margin-left:10px}
.btn:hover{transform:translateY(-2px)}
.f-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:44px 0 20px}
.f-card{display:flex;gap:14px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:20px;transition:transform .35s cubic-bezier(.22,1,.36,1),box-shadow .35s}
.f-card:hover{transform:translateY(-4px);box-shadow:0 16px 36px rgba(10,20,40,.09)}
.f-ic{font-size:1.5rem}.f-t{font-weight:600;margin-bottom:4px}.f-card p{font-size:.84rem;color:var(--mut);line-height:1.65}
.suite-nav{margin:44px 0 60px;padding-top:26px;border-top:1px solid var(--line)}
.suite-nav h4{font-family:var(--fd);margin-bottom:14px;color:var(--mut);font-weight:500}
.pl{display:inline-block;margin:0 8px 8px 0;background:#fff;border:1px solid var(--line);border-radius:99px;padding:8px 16px;font-size:.8rem;transition:transform .25s}
.pl:hover{transform:translateY(-2px);border-color:var(--accent)}
.lang-pill{background:transparent;border:1px solid var(--line);border-radius:99px;padding:7px 12px;font-family:var(--fb);font-size:.8rem;cursor:pointer;color:var(--ink)}
[dir="rtl"] .hero,[dir="rtl"] .f-card{text-align:right;direction:rtl}
footer{border-top:1px solid var(--line);padding:24px 0;font-size:.78rem;color:var(--mut)}
@media(max-width:760px){.f-grid{grid-template-columns:1fr}.btn-line{margin-left:0;margin-top:10px}}
</style></head><body>
<div class="wrap">
<nav><a class="logo" href="/"><div class="logo-mark"><span>λ</span></div>Japa<span class="logo-quest">Quest</span></a>
  <div style="display:flex;align-items:center;gap:14px">
    <select class="lang-pill" onchange="location.search='?lang='+this.value" aria-label="Language">${langOpts}</select>
    <a class="top-link" href="/#suite">${esc5(T('suite_all'))}</a>
  </div></nav>
<section class="hero">
  <div class="kick">${p.icon} ${esc5(BRAND.NAME)} suite · ${esc5(p.name)}</div>
  <h1>${esc5(p.short.replace(/\s*&\s*/,' & '))}, <em>${esc5(T('suite_handled'))}</em></h1>
  <p class="sub">${esc5(p.desc)}</p>
  <a class="btn btn-acc" href="/">${esc5(p.cta)} →</a><a class="btn btn-line" href="/#suite">${esc5(T('suite_compare'))}</a>
  <div class="f-grid">${feats}
  </div>
  <div class="suite-nav"><h4>${esc5(T('suite_continue'))}</h4>${nav}</div>
</section>
<footer>© 2026 ${esc5(BRAND.NAME)} — ${esc5(BRAND.TAGLINE)} ${esc5(T('suite_disclaimer'))}</footer>
</div></body></html>`);
});

// ── PUBLIC AFFILIATE PAGE ───────────────────────────────────────────────────
app.get('/affiliate', (req, res) => {
  const rate = Math.round((parseFloat(Q.getSetting('affiliate_commission_rate')) || 0.30) * 100);
  let maxRate = rate;
  try { (JSON.parse(Q.getSetting('affiliate_tiers') || '[]')).forEach(t => { const r = Math.round(t.rate * 100); if (r > maxRate) maxRate = r; }); } catch {}
  const appUrl = (Q.getSetting('app_url') || process.env.APP_URL || '').replace(/\/$/, '');
  const payNote = `Payouts are sent manually once your balance is due — choose Payoneer, bank transfer, USDT/BTC, OPay or mobile money in your dashboard.`;
  res.send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Earn up to ${maxRate}% — ${esc5(BRAND.NAME)} Affiliate Program</title>
<meta name="description" content="Share ${esc5(BRAND.NAME)} with your audience and earn ${rate}%${maxRate > rate ? ' (up to ' + maxRate + '% with performance tiers)' : ''} commission on every paid plan. Individuals, groups and organisations welcome."/>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet"/>
<style>
:root{--paper:#F7F3EA;--ink:#0A1428;--accent:#E8613C;--mut:rgba(10,20,40,.62);--line:rgba(10,20,40,.12);--fd:Fraunces,Georgia,serif;--fb:Outfit,Segoe UI,sans-serif}
*{margin:0;box-sizing:border-box}body{background:var(--paper);color:var(--ink);font-family:var(--fb)}
a{text-decoration:none;color:inherit}.wrap{max-width:860px;margin:0 auto;padding:0 22px}
nav{display:flex;justify-content:space-between;align-items:center;padding:20px 0;border-bottom:1px solid var(--line)}
.logo{display:flex;align-items:center;gap:9px;font-family:var(--fd);font-weight:700;font-size:1.06rem}
.logo-mark{width:34px;height:34px;border-radius:10px;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;font-size:1rem}
.logo-quest{color:var(--accent)}.top-link{font-size:.82rem;color:var(--mut)}
.hero{padding:60px 0 34px}.kick{display:inline-block;font-size:.72rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);border:1px solid var(--line);border-radius:99px;padding:6px 14px;margin-bottom:20px;background:#fff}
h1{font-family:var(--fd);font-size:clamp(2rem,4.6vw,3rem);line-height:1.12;font-weight:700}h1 em{font-style:italic;color:var(--accent)}
.sub{margin:16px 0 8px;font-size:1.02rem;color:var(--mut);max-width:620px;line-height:1.7}
.big-rate{display:inline-flex;align-items:baseline;gap:8px;margin:18px 0 6px;background:var(--ink);color:var(--paper);border-radius:18px;padding:14px 26px}
.big-rate b{font-family:var(--fd);font-size:2rem}.big-rate span{font-size:.8rem;opacity:.75}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin:36px 0 8px}
.step{background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px;transition:transform .35s cubic-bezier(.22,1,.36,1),box-shadow .35s}
.step:hover{transform:translateY(-4px);box-shadow:0 16px 36px rgba(10,20,40,.09)}
.step .n{font-family:var(--fd);color:var(--accent);font-size:1.1rem;margin-bottom:6px}.step h3{font-size:.95rem;margin-bottom:5px}.step p{font-size:.8rem;color:var(--mut);line-height:1.6}
.card{background:#fff;border:1px solid var(--line);border-radius:22px;padding:30px;margin:38px 0 60px}
.card h2{font-family:var(--fd);font-size:1.4rem;margin-bottom:6px}
.card .lead{font-size:.86rem;color:var(--mut);margin-bottom:20px}
label{display:block;font-size:.74rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);margin:14px 0 5px}
input,textarea,select{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--paper);font-family:var(--fb);font-size:.92rem;color:var(--ink)}
input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:0;border-color:transparent}
.btn{display:inline-block;border-radius:99px;padding:13px 30px;font-weight:600;font-size:.92rem;border:none;cursor:pointer;transition:transform .3s cubic-bezier(.22,1,.36,1)}
.btn-acc{background:var(--accent);color:#fff;margin-top:20px}.btn:hover{transform:translateY(-2px)}
#ok{display:none;text-align:center;padding:16px 0 4px}
#ok .code{font-family:var(--fd);font-size:2rem;color:var(--accent);letter-spacing:.06em;margin:10px 0}
#ok .lnk{word-break:break-all;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-size:.82rem;margin:12px 0;display:block}
.share{display:flex;gap:10px;justify-content:center;margin-top:12px;flex-wrap:wrap}
.share a{background:var(--ink);color:var(--paper);border-radius:99px;padding:9px 18px;font-size:.8rem}
#err{display:none;color:#B3282D;font-size:.84rem;margin-top:14px}
.pays{font-size:.78rem;color:var(--mut);margin-top:14px;line-height:1.6}
footer{border-top:1px solid var(--line);padding:24px 0;font-size:.78rem;color:var(--mut)}
@media(max-width:640px){.card{padding:22px}}
</style></head><body>
<div class="wrap">
<nav><a class="logo" href="/"><div class="logo-mark"><span>λ</span></div>Japa<span class="logo-quest">Quest</span></a><a class="top-link" href="/">← Back to ${esc5(BRAND.NAME)}</a></nav>
<section class="hero">
  <div class="kick">🤝 Partner program</div>
  <h1>Share the journey. <em>Earn up to ${maxRate}%.</em></h1>
  <p class="sub">Refer travellers, study-abroad hopefuls, organisations and communities to ${esc5(BRAND.NAME)}. When anyone registers through your link and pays for a plan, you earn <strong>${rate}% of the payment</strong>${maxRate > rate ? ` — growing to <strong>${maxRate}%</strong> as your referrals pay` : ''} — every time they pay.</p>
  <div class="big-rate"><b>${maxRate}%</b><span>commission on every paid plan${maxRate > rate ? ' (performance tiers)' : ''}</span></div>
  <div class="steps">
    <div class="step"><div class="n">1</div><h3>Apply</h3><p>Individuals, groups and organisations — tell us who you are and where your audience lives.</p></div>
    <div class="step"><div class="n">2</div><h3>Get your tracking code</h3><p>Approved within 24h. Your code works instantly — commissions flow once approved.</p></div>
    <div class="step"><div class="n">3</div><h3>Share anywhere</h3><p>WhatsApp, X, Facebook, Telegram, classrooms, church groups — 30-day cookie attribution.</p></div>
    <div class="step"><div class="n">4</div><h3>Get paid</h3><p>Watch clicks, signups and commissions live in your dashboard. Withdraw when due.</p></div>
  </div>
</section>
<div class="card" id="apply-card">
  <div id="form-zone">
    <h2>Apply for your tracking code</h2>
    <p class="lead">Takes under a minute. Your code is emailed to you immediately.</p>
    <form id="af-form">
      <label for="af-name">Your name or organisation</label>
      <input id="af-name" required maxlength="120" placeholder="e.g. Ada Obi or Lagos Travel Club"/>
      <label for="af-email">Email</label>
      <input id="af-email" type="email" required maxlength="160" placeholder="you@example.com"/>
      <label for="af-org">Organisation (optional — for groups)</label>
      <input id="af-org" maxlength="160" placeholder="e.g. Campus Fellowship Media Team"/>
      <label for="af-aud">Audience / channels (optional)</label>
      <textarea id="af-aud" rows="2" maxlength="500" placeholder="e.g. 12k WhatsApp travel group, TikTok @handle, university mailing list"></textarea>
      <button class="btn btn-acc" type="submit">Get my tracking code →</button>
      <div id="err"></div>
    </form>
  </div>
  <div id="ok">
    <h2>You're in! 🎉</h2>
    <p class="lead">Your tracking code — we've also emailed it to you:</p>
    <div class="code" id="ok-code"></div>
    <span class="lnk" id="ok-link"></span>
    <div class="share">
      <a id="ok-wa" target="_blank" rel="noopener">WhatsApp</a>
      <a id="ok-x" target="_blank" rel="noopener">X / Twitter</a>
      <a id="ok-fb" target="_blank" rel="noopener">Facebook</a>
      <a id="ok-dash" href="/dashboard#earnings">Dashboard →</a>
    </div>
  </div>
  <div class="pays">💸 ${esc5(payNote)}<br/>Questions? <a href="mailto:support@japaplus.app" style="color:var(--accent)">support@japaplus.app</a></div>
</div>
<footer>© 2026 ${esc5(BRAND.NAME)} — ${esc5(BRAND.TAGLINE)} Fraud or self-referral abuse voids commissions.</footer>
</div>
<script>
const $=id=>document.getElementById(id);
document.getElementById('af-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=e.target.querySelector('button');btn.disabled=true;btn.textContent='Submitting…';
  try{
    const r=await fetch('/api/affiliate/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('af-name').value.trim(),email:$('af-email').value.trim(),org:$('af-org').value.trim(),audience:$('af-aud').value.trim()})});
    const d=await r.json();
    if(r.status===201){
      const base=(${JSON.stringify(appUrl)}||location.origin)+'/r/'+d.code;
      const tagged=t=>base+'?s='+t; // source-tagged so analytics show which channel converts
      $('ok-code').textContent=d.code;$('ok-link').textContent=base;
      const brand='${esc5(BRAND.NAME)}';
      $('ok-wa').href='https://wa.me/?text='+encodeURIComponent('Plan your visa, studies, work or relocation abroad with '+brand+' — start free: '+tagged('wa'));
      $('ok-x').href='https://twitter.com/intent/tweet?text='+encodeURIComponent('Plan your journey abroad with '+brand+' — start free:')+'&url='+encodeURIComponent(tagged('x'));
      $('ok-fb').href='https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(tagged('fb'));
      $('form-zone').style.display='none';$('ok').style.display='block';
    }else{
      $('err').style.display='block';$('err').textContent=d.error||('Application failed ('+r.status+')');
      btn.disabled=false;btn.textContent='Get my tracking code →';
    }
  }catch(err){
    $('err').style.display='block';$('err').textContent='Network error — please try again.';
    btn.disabled=false;btn.textContent='Get my tracking code →';
  }
});
</script>
</body></html>`);
});

// ── SPA ROUTING ───────────────────────────────────────────────────────────────
app.get('/admin',       (_req,res) => res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/admin-login', (_req,res) => res.sendFile(path.join(__dirname,'public','admin-login.html')));
app.get('/admin-japa',  (_req,res) => res.sendFile(path.join(__dirname,'public','admin-japa.html')));
app.get('/dashboard',   (_req,res) => res.sendFile(path.join(__dirname,'public','dashboard.html')));
app.get('/app',         (_req,res) => res.sendFile(path.join(__dirname,'public','app.html')));
app.get('/',            (_req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
app.get('*',            (_req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
app.use((err,_req,res,next) => {
  if (res.headersSent) return next(err);
  console.error('[server]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── START ─────────────────────────────────────────────────────────────────────
async function start() {
  console.log('\n🗄  Initialising JapaQuest database with sql.js…');
  await initDB();
  console.log('✅ Database ready\n');

  fx.startFx(); // daily exchange-rate refresh (falls back to static table offline)

  const PORT = parseInt(process.env.PORT)||4001;
  require('./worker/social-scheduler').startSocialScheduler();
  require('./worker/journey-scheduler').startJourneyScheduler();
  app.listen(PORT, () => {
    const name = Q.getSetting('app_name')||BRAND.NAME;
    console.log(`
╔══════════════════════════════════════════════════════╗
║   ${name.padEnd(50)} ║
║   ${BRAND.TAGLINE.padEnd(50)} ║
╠══════════════════════════════════════════════════════╣
║  App:      http://localhost:${PORT}                    ║
║  Dashboard:http://localhost:${PORT}/dashboard          ║
║  Admin:    http://localhost:${PORT}/admin              ║
║  Japa:     http://localhost:${PORT}/admin-japa         ║
╠══════════════════════════════════════════════════════╣
║  Admin:    admin@jagaguru.ai / Admin@1234!           ║
╚══════════════════════════════════════════════════════╝
    `);
  });
}

start().catch(e => { console.error('Startup failed:', e); process.exit(1); });

// Graceful shutdown — cPanel restarts the app on deploy/toggle; flush the
// debounced SQLite writes first so the last 200ms of changes are never lost.
['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => {
  console.log(`\n${sig} received — flushing database and shutting down…`);
  try { persist(); } catch (e) { console.error('flush failed:', e.message); }
  process.exit(0);
}));

// Friendly guidance when the port is taken (e.g. a previous instance is
// still running) instead of an unhandled 'error' event stack trace.
process.on('uncaughtException', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    const port = (e.port || e.address || '').toString().replace('::', '') || '4001';
    console.error(`\n❌ Port ${port} is already in use — another server instance is probably still running.`);
    console.error(`   Fix:   lsof -ti tcp:${port} | xargs kill`);
    console.error(`   Or:    PORT=4002 npm start\n`);
    process.exit(1);
  }
  console.error('\n❌ Unexpected error:', e && e.stack || e);
  process.exit(1);
});
