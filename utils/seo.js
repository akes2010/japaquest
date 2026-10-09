'use strict';
// ══════════════════════════════════════════════════════════════════════════
// utils/seo.js — complete on-site SEO + one-click "sell itself" promotion.
// ────────────────────────────────────────────────────────────────────────
//  • sitemap()   → XML sitemap of every public URL (landing, suite pages,
//                  affiliate program, seeded destination visa guides)
//  • robots()    → robots.txt pointing at the sitemap, sane crawl rules
//  • metaTags()  → canonical/OG/Twitter/JSON-LD head block for public pages
//  • submit()    → "sell itself" toggle: pings IndexNow (Bing/Yandex/Naver
//                  via api.indexnow.org) and Google's legacy sitemap ping,
//                  archives the verification key file, and records results.
//
// Everything renders live from the settings table, so changing the app name,
// tagline or domain in Admin → System Settings updates SEO instantly.
// ══════════════════════════════════════════════════════════════════════════
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const BRAND = require('../config/brand');

function baseUrl() {
  const s = require('../db').Q.getSetting('app_url') || process.env.APP_URL || '';
  const t = String(s).replace(/\/+$/, '');
  return /^https?:\/\//.test(t) ? t : 'https://example.com';
}
function siteName()  { return require('../db').Q.getSetting('app_name')    || BRAND.NAME; }
function tagline()   { return require('../db').Q.getSetting('app_tagline') || BRAND.TAGLINE; }
function supportEmail() { return require('../db').Q.getSetting('support_email') || ''; }

const DESC =
  'Visa answers from verified official sources, embassy-ready cover letters, ' +
  'real trip budgets in dollars, and the full travel suite — AI, Visa, Travel, Study, Work, Move, Business and Concierge.';

// ── SITEMAP ──────────────────────────────────────────────────────────────
function urls() {
  const base = baseUrl();
  const list = [
    { loc: `${base}/`,            priority: '1.0', changefreq: 'daily' },
    { loc: `${base}/#pricing`,    priority: '0.8', changefreq: 'weekly' },
    { loc: `${base}/affiliate`,   priority: '0.8', changefreq: 'weekly' },
  ];
  for (const p of BRAND.SUITE)
    list.push({ loc: `${base}/suite/${p.key}`, priority: '0.9', changefreq: 'weekly' });
  // Destination guides from seeded data (public, crawlable, keyword-rich)
  try {
    const rows = require('../db').Q.queryAllSafe(
      `SELECT DISTINCT d.code, d.name FROM destinations d
       JOIN visa_rules v ON v.destination_code = d.code LIMIT 500`);
    for (const r of rows) list.push({ loc: `${base}/suite/visa?d=${r.code}`, priority: '0.7', changefreq: 'weekly' });
  } catch {}
  if (supportEmail()) list.push({ loc: `${base}/contact`, priority: '0.4', changefreq: 'monthly' });
  return list;
}

function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const items = urls().map(u =>
    `  <url><loc>${u.loc.replace(/&/g, '&amp;')}</loc><lastmod>${today}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
}

// ── ROBOTS ───────────────────────────────────────────────────────────────
function robots() {
  const base = baseUrl();
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /admin-japa',
    'Disallow: /admin-login',
    'Disallow: /dashboard',
    'Disallow: /api/',
    'Disallow: /uploads/',
    '',
    '# AI crawlers — welcome (they cite sources)',
    'User-agent: GPTBot',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    '',
    `User-agent: Googlebot`,
    `Allow: /`,
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}

// ── HEAD META (canonical, OG, Twitter, JSON-LD) ──────────────────────────
// opts: { title, description, path, image, type }
function metaTags(opts = {}) {
  const base = baseUrl();
  const name = siteName();
  const url = opts.path ? `${base}${opts.path}` : base;
  const title = opts.title ? `${opts.title} — ${name}` : `${name} — ${tagline()}`;
  const desc = opts.description || DESC;
  const img = opts.image || `${base}/icons/icon.svg`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name,
    alternateName: `${name} Travel Intelligence`,
    url: base,
    description: desc,
    inLanguage: 'en',
  };
  if (supportEmail()) ld.contactPoint = { '@type': 'ContactPoint', email: supportEmail(), contactType: 'customer support' };
  return [
    `<link rel="canonical" href="${url}"/>`,
    `<meta name="robots" content="index,follow,max-image-preview:large"/>`,
    `<meta property="og:type" content="${opts.type || 'website'}"/>`,
    `<meta property="og:site_name" content="${name}"/>`,
    `<meta property="og:title" content="${title}"/>`,
    `<meta property="og:description" content="${desc}"/>`,
    `<meta property="og:url" content="${url}"/>`,
    `<meta property="og:image" content="${img}"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${title}"/>`,
    `<meta name="twitter:description" content="${desc}"/>`,
    `<meta name="twitter:image" content="${img}"/>`,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
  ].join('\n');
}

// ── SUBMISSION ("sell itself" toggle) ────────────────────────────────────
// One admin click (or cron): tellIndexEverything. Severity-order:
//   1. IndexNow → instant indexing for Bing/Yandex/Seznam/Naver (key file
//      must exist at the site root; we generate + serve it automatically).
//   2. Google sitemap ping (legacy but still honoured for sitemaps).
// Results are stored in settings so the admin panel shows last-run state.
async function submitToSearchEngines() {
  const Q = require('../db').Q;
  const base = baseUrl();
  if (!/^https?:\/\//.test(base) || /example\.com|localhost/.test(base))
    return { ok: false, error: `APP_URL is "${base}" — set the real https://domain in Admin → System Settings before submitting.` };

  const keySetting = Q.getSetting('seo_indexnow_key');
  const key = /^[a-f0-9]{16,}$/i.test(keySetting || '') ? keySetting : crypto.randomBytes(16).toString('hex');
  if (key !== keySetting) Q.setSetting('seo_indexnow_key', key, 'general');

  // Make the verification key file discoverable: data file + served route.
  try {
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', 'data', `${key}.txt`), key);
  } catch {}

  const results = { key, submitted_at: new Date().toISOString(), engines: [] };
  const urlsToPing = urls().map(u => u.loc);

  // IndexNow accepts batches of up to 10k URLs per call.
  const hosts = [
    { name: 'IndexNow (Bing, Yandex, Seznam, Naver)', url: 'https://api.indexnow.org/indexnow' },
    { name: 'Bing',  url: 'https://www.bing.com/indexnow' },
    { name: 'Yandex', url: 'https://yandex.com/indexnow' },
  ];
  for (const h of hosts) {
    try {
      const body = JSON.stringify({ host: base.replace(/^https?:\/\//, '').split('/')[0], key, keyLocation: `${base}/${key}.txt`, urlList: urlsToPing });
      const res = await fetch(h.url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body, timeout: 20000 });
      results.engines.push({ engine: h.name, status: res.status, ok: res.status === 200 || res.status === 202 });
    } catch (e) {
      results.engines.push({ engine: h.name, ok: false, error: e.message });
    }
  }
  // Google: sitemap ping (legacy endpoint; harmless if deprecated).
  try {
    const res = await fetch(`https://www.google.com/ping?sitemap=${encodeURIComponent(base)}/sitemap.xml`, { timeout: 20000 });
    results.engines.push({ engine: 'Google (sitemap ping)', status: res.status, ok: res.status < 500 });
  } catch (e) {
    results.engines.push({ engine: 'Google (sitemap ping)', ok: false, error: e.message });
  }

  Q.setSetting('seo_last_submit', JSON.stringify(results), 'seo');
  // "Auto-sell" toggle state stays in Admin → SEO; storing the timestamp makes UI trivial.
  Q.setSetting('seo_last_submit_at', results.submitted_at, 'seo');
  return results;
}

module.exports = { sitemap, robots, metaTags, submitToSearchEngines, baseUrl, siteName, tagline, DESC };
