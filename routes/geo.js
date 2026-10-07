'use strict';
/**
 * Geo routes — one endpoint powers flag, currency and language targeting.
 *
 * GET  /api/geo            → { country, flag, currency, currencySymbol, lang,
 *                              rtl, strings, languages, fx:{live,fetchedAt} }
 * GET  /api/geo/convert    → ?usd=100&to=NGN  (or ?amounts=1,2,3&to=…)
 * POST /api/geo/pref       → save the traveller's country/currency/language
 */
const router = require('express').Router();
const geo = require('../utils/geo');
const fx = require('../utils/fx');
const i18n = require('../utils/i18n');
const { requireAuth, verifyToken } = require('../middleware/auth');
const { Q } = require('../db');

// /api/geo is public but honours a Bearer token when present, so travellers
// with saved locale prefs get them without a separate authenticated call.
function optionalAuth(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return;
  const payload = verifyToken(auth.slice(7));
  if (payload) req.user = Q.getUserByUUID(payload.uuid);
}

// Resolve the effective locale for this request (used by /geo and /pref GET).
function resolveLocale(req) {
  const g = geo.detectSync(req);
  const lang = i18n.negotiate({ pref: req.query.lang, acceptLanguage: req.headers['accept-language'], geoLanguages: g.languages });
  return { geo: g, lang };
}

// ── Detect: country, flag, currency, language, FX status ─────────────────────
router.get('/', async (req, res) => {
  optionalAuth(req);
  const { geo: g, lang } = await (async () => {
    const snapshot = geo.detectSync(req);
    // Header-only hit → use it; otherwise try a live IP lookup (2.5s cap).
    if (geo.countryFromHeaders(req) || geo.cachePeek(geo.clientIp(req))) {
      return { geo: snapshot, lang: i18n.negotiate({ pref: req.query.lang, acceptLanguage: req.headers['accept-language'], geoLanguages: snapshot.languages }) };
    }
    const full = await geo.detect(req);
    return { geo: full, lang: i18n.negotiate({ pref: req.query.lang, acceptLanguage: req.headers['accept-language'], geoLanguages: full.languages }) };
  })();

  // Authenticated travellers get their saved prefs unless ?lang= overrides.
  let pref = null;
  if (req.user) {
    pref = {
      country: req.user.geo_country || null,
      currency: req.user.geo_currency || null,
      lang: req.user.geo_lang || null,
    };
  }
  const currency = (req.query.currency || (pref && pref.currency) || g.currency || 'USD').toUpperCase();
  const effLang = i18n.isSupported(req.query.lang) ? req.query.lang
    : (pref && pref.lang && i18n.isSupported(pref.lang) ? pref.lang : lang);

  const fxst = fx.status();
  res.json({
    country: g.country, countryName: g.countryName, flag: g.flag,
    currency, currencySymbol: fx.SYMBOLS[currency] || currency,
    currencyLive: fxst.live, fxUpdated: fxst.fetchedAt,
    fx_rates: fx.ratesSnapshot(),
    currency_symbols: fx.SYMBOLS,
    lang: effLang, rtl: i18n.RTL.has(effLang), strings: i18n.bundle(effLang).strings,
    languages: i18n.LANGUAGES,
    detected: { via: geo.countryFromHeaders(req) ? 'cdn-header' : (geo.cachePeek(geo.clientIp(req)) ? 'ip-cache' : 'ip-lookup-or-default'), geoCountry: g.country },
    pref,
  });
});

// ── Convert USD amounts (single or batch) ────────────────────────────────────
router.get('/convert', (req, res) => {
  const to = String(req.query.to || 'USD').toUpperCase();
  const single = req.query.usd;
  const amounts = single !== undefined ? [parseFloat(single)] : String(req.query.amounts || '').split(',').map(parseFloat).filter(Number.isFinite);
  if (!amounts.length) return res.status(400).json({ error: 'usd or amounts required' });
  res.json({
    to,
    converted: amounts.map(a => ({ usd: a, value: fx.fromUSD(a, to), formatted: fx.fmtUSD(a, to) })),
  });
});

// ── Traveller locale prefs (country/currency/language) ───────────────────────
router.post('/pref', requireAuth, (req, res) => {
  const { country, currency, lang } = req.body || {};
  const updates = {};
  if (country !== undefined) {
    const cc = String(country).toUpperCase();
    if (cc === '' || geo.COUNTRIES[cc]) updates.geo_country = cc || null;
  }
  if (currency !== undefined) {
    const cur = String(currency).toUpperCase();
    if (cur === '' || fx.SYMBOLS[cur]) updates.geo_currency = cur || null;
  }
  if (lang !== undefined) {
    if (lang === '' || i18n.isSupported(lang)) updates.geo_lang = lang || null;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update (invalid country/currency/lang)' });
  Q.setUserGeoPrefs(req.user.id, updates);
  res.json({ message: 'Locale preferences saved', ...updates });
});

router.get('/pref', requireAuth, (req, res) => {
  res.json({ country: req.user.geo_country || null, currency: req.user.geo_currency || null, lang: req.user.geo_lang || null });
});

module.exports = router;
