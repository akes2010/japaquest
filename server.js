'use strict';
require('dotenv').config();
const express  = require('express');
const path     = require('path');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const compress = require('compression');
const rateLimit= require('express-rate-limit');
const { initDB, Q, persist } = require('./db');
const BRAND = require('./config/brand');

const app = express();

// ── SECURITY ──────────────────────────────────────────────────────────────────
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
app.use(compress());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
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
  res.json({
    status: db === 'ok' ? 'ok' : 'degraded',
    uptime_sec: Math.floor(process.uptime()),
    db,
    db_latency_ms: Date.now() - t0,
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
  const feats = p.features.map(([ic,t,d]) => `
      <div class="f-card"><div class="f-ic">${ic}</div><div><div class="f-t">${esc5(t)}</div><p>${esc5(d)}</p></div></div>`).join('');
  const nav = others.map(o => `<a class="pl" href="/suite/${o.key}">${o.icon} ${esc5(o.name)}</a>`).join('');
  res.send(`<!DOCTYPE html><html lang="en"><head>
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
footer{border-top:1px solid var(--line);padding:24px 0;font-size:.78rem;color:var(--mut)}
@media(max-width:760px){.f-grid{grid-template-columns:1fr}.btn-line{margin-left:0;margin-top:10px}}
</style></head><body>
<div class="wrap">
<nav><a class="logo" href="/"><div class="logo-mark"><span>λ</span></div>Japa<span class="logo-quest">Quest</span></a><a class="top-link" href="/#suite">← All eight products</a></nav>
<section class="hero">
  <div class="kick">${p.icon} ${esc5(BRAND.NAME)} suite · ${esc5(p.name)}</div>
  <h1>${esc5(p.short.replace(/\s*&\s*/,' & '))}, <em>handled.</em></h1>
  <p class="sub">${esc5(p.desc)}</p>
  <a class="btn btn-acc" href="/">${esc5(p.cta)} →</a><a class="btn btn-line" href="/#suite">Compare all lines</a>
  <div class="f-grid">${feats}
  </div>
  <div class="suite-nav"><h4>Continue through the suite</h4>${nav}</div>
</section>
<footer>© 2026 ${esc5(BRAND.NAME)} — ${esc5(BRAND.TAGLINE)} Not a substitute for official embassy advice.</footer>
</div></body></html>`);
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
