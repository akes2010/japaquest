'use strict';
require('dotenv').config();
const express  = require('express');
const path     = require('path');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const compress = require('compression');
const rateLimit= require('express-rate-limit');
const { initDB, Q } = require('./db');

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
  name:        Q.getSetting('app_name')    || 'Japa+',
  tagline:     Q.getSetting('app_tagline') || 'Travel smart. Land ready.',
  logo:        Q.getSetting('app_logo')    || '✈',
  logoUrl:     Q.getSetting('app_logo_url')|| '',
  supportEmail:Q.getSetting('support_email')|| '',
  maintenance: Q.getSetting('maintenance_mode')==='1',
  regOpen:     Q.getSetting('registration_open')!=='0',
}));

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
app.use('/api/visa',   require('./routes/visa-db'));
app.use('/api/chat',   require('./routes/chat'));

// ── API 404 ───────────────────────────────────────────────────────────────────
// Unknown API endpoints must return JSON 404, never the SPA fallback below.
app.use('/api', (_req,res) => res.status(404).json({ error: 'Endpoint not found' }));

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
  console.log('\n🗄  Initialising JapaGuru database with sql.js…');
  await initDB();
  console.log('✅ Database ready\n');

  const PORT = parseInt(process.env.PORT)||4000;
  require('./worker/social-scheduler').startSocialScheduler();
  app.listen(PORT, () => {
    const name = Q.getSetting('app_name')||'Japa+';
    console.log(`
╔══════════════════════════════════════════════════════╗
║   ${name.padEnd(50)} ║
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
