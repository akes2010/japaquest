'use strict';
/**
 * Geo detection — figures out where a visitor is from, cheaply and safely.
 *
 * Resolution order (cheapest first):
 *   1. CDN geo headers (Cloudflare `cf-ipcountry`, Vercel, nginx `geoip2`…)
 *   2. In-memory IP→country cache (24h TTL, LRU-ish cap)
 *   3. Free IP lookup (ipapi.co, 1k/day free) — best-effort, never blocks >2.5s
 *   4. DEFAULT_COUNTRY env or 'NG' (the product's core audience)
 *
 * From the country we derive: flag emoji, currency code + symbol, and the
 * traveller's likely languages (for multi-language targeting).
 */
const https = require('https');

// ── Country table: ISO2 → { name, flag, currency, langs } ────────────────────
// Covers all African countries (core audience) + major world travellers.
const C = (name, currency, langs) => ({ name, currency, langs });
const COUNTRIES = {
  // West Africa
  NG: C('Nigeria','NGN',['en','ha','yo','ig']), GH: C('Ghana','GHS',['en','tw']),
  SN: C('Senegal','XOF',['fr','wo']), CI: C("Côte d'Ivoire",'XOF',['fr']),
  CM: C('Cameroon','XAF',['fr','en']), BF: C('Burkina Faso','XOF',['fr']),
  ML: C('Mali','XOF',['fr']), NE: C('Niger','XOF',['fr']),
  TG: C('Togo','XOF',['fr']), BJ: C('Benin','XOF',['fr','yo']),
  GW: C('Guinea-Bissau','XOF',['pt']), GN: C('Guinea','GNF',['fr']),
  LR: C('Liberia','LRD',['en']), SL: C('Sierra Leone','SLE',['en']),
  GM: C('Gambia','GMD',['en']), MR: C('Mauritania','MRU',['ar','fr']),
  // East Africa
  KE: C('Kenya','KES',['en','sw']), TZ: C('Tanzania','TZS',['en','sw']),
  UG: C('Uganda','UGX',['en','sw']), ET: C('Ethiopia','ETB',['am','en']),
  RW: C('Rwanda','RWF',['en','fr','rw']), BI: C('Burundi','BIF',['fr','rn']),
  SO: C('Somalia','SOS',['so','ar']), DJ: C('Djibouti','DJF',['fr','ar']),
  ER: C('Eritrea','ERN',['ti','ar']), SS: C('South Sudan','SSP',['en']),
  // Southern Africa
  ZA: C('South Africa','ZAR',['en','af','zu']), ZW: C('Zimbabwe','ZWG',['en','sn']),
  ZM: C('Zambia','ZMW',['en']), MW: C('Malawi','MWK',['en','ny']),
  MZ: C('Mozambique','MZN',['pt']), BW: C('Botswana','BWP',['en','tn']),
  NA: C('Namibia','NAD',['en','af']), MG: C('Madagascar','MGA',['mg','fr']),
  MU: C('Mauritius','MUR',['en','fr']), SC: C('Seychelles','SCR',['en','fr']),
  AO: C('Angola','AOA',['pt']), LS: C('Lesotho','LSL',['en','st']),
  SZ: C('Eswatini','SZL',['en','ss']), KM: C('Comoros','KMF',['ar','fr']),
  // North Africa
  EG: C('Egypt','EGP',['ar','en']), MA: C('Morocco','MAD',['ar','fr']),
  DZ: C('Algeria','DZD',['ar','fr']), TN: C('Tunisia','TND',['ar','fr']),
  LY: C('Libya','LYD',['ar']), SD: C('Sudan','SDG',['ar','en']),
  EH: C('Western Sahara','MAD',['ar']),
  // Central Africa
  CD: C('DR Congo','CDF',['fr','sw']), CG: C('Congo','XAF',['fr']),
  GA: C('Gabon','XAF',['fr']), GQ: C('Equatorial Guinea','XAF',['es','fr']),
  TD: C('Chad','XAF',['fr','ar']), CF: C('Central African Rep.','XAF',['fr','sg']),
  CV: C('Cabo Verde','CVE',['pt']), ST: C('São Tomé & Príncipe','STN',['pt']),
  // Major world travellers / diaspora hubs
  US: C('United States','USD',['en']), GB: C('United Kingdom','GBP',['en']),
  CA: C('Canada','CAD',['en','fr']), IE: C('Ireland','EUR',['en']),
  FR: C('France','EUR',['fr']), DE: C('Germany','EUR',['de']),
  ES: C('Spain','EUR',['es']), PT: C('Portugal','EUR',['pt']),
  IT: C('Italy','EUR',['it']), NL: C('Netherlands','EUR',['nl']),
  BE: C('Belgium','EUR',['nl','fr']), CH: C('Switzerland','CHF',['de','fr']),
  AT: C('Austria','EUR',['de']), BR: C('Brazil','BRL',['pt']),
  CN: C('China','CNY',['zh']), IN: C('India','INR',['hi','en']),
  AE: C('UAE','AED',['ar','en']), SA: C('Saudi Arabia','SAR',['ar']),
  QA: C('Qatar','QAR',['ar']), TR: C('Türkiye','TRY',['tr']),
  AU: C('Australia','AUD',['en']), NZ: C('New Zealand','NZD',['en']),
  JP: C('Japan','JPY',['ja']), KR: C('South Korea','KRW',['ko']),
  IL: C('Israel','ILS',['he','ar']), RU: C('Russia','RUB',['ru']),
  MX: C('Mexico','MXN',['es']), AR: C('Argentina','ARS',['es']),
  // Extended world coverage (2026 build-out)
  ID: C('Indonesia','IDR',['id','en']), MY: C('Malaysia','MYR',['ms','en']),
  SG: C('Singapore','SGD',['en','zh','ms']), TH: C('Thailand','THB',['th','en']),
  VN: C('Vietnam','VND',['vi','en']), PH: C('Philippines','PHP',['en','tl']),
  PK: C('Pakistan','PKR',['ur','en']), BD: C('Bangladesh','BDT',['bn','en']),
  LK: C('Sri Lanka','LKR',['si','en']), NP: C('Nepal','NPR',['ne','en']),
  KE2: undefined, // placeholder removed below
  NZ2: undefined, // placeholder removed below
  UA: C('Ukraine','UAH',['uk','en']), PL: C('Poland','PLN',['pl','en']),
  RO: C('Romania','RON',['ro','en']), CZ: C('Czechia','CZK',['cs','en']),
  HU: C('Hungary','HUF',['hu','en']), GR: C('Greece','EUR',['el','en']),
  SE: C('Sweden','SEK',['sv','en']), NO: C('Norway','NOK',['no','en']),
  DK: C('Denmark','DKK',['da','en']), FI: C('Finland','EUR',['fi','en']),
  KE: C('Kenya','KES',['en','sw']),
  JM: C('Jamaica','JMD',['en']), TT: C('Trinidad & Tobago','TTD',['en']),
  BB: C('Barbados','BBD',['en']), DO: C('Dominican Rep.','DOP',['es','en']),
  CO: C('Colombia','COP',['es','en']), PE: C('Peru','PEN',['es','en']),
  CL: C('Chile','CLP',['es','en']), EC: C('Ecuador','USD',['es','en']),
};
// Clean up placeholder keys
delete COUNTRIES.KE2; delete COUNTRIES.NZ2;
// Currency symbols (Intl handles most; these are the display-critical ones)
const SYMBOLS = { USD:'$', EUR:'€', GBP:'£', NGN:'₦', GHS:'GH₵', KES:'KSh', ZAR:'R',
  EGP:'E£', MAD:'DH', AED:'د.إ', SAR:'﷼', INR:'₹', CNY:'¥', JPY:'¥', BRL:'R$',
  XOF:'CFA', XAF:'FCFA', TZS:'TSh', UGX:'USh', RWF:'RF', ETB:'Br', GMD:'D', ZMW:'K' };

const DEFAULT_COUNTRY = (process.env.DEFAULT_COUNTRY || 'NG').toUpperCase();
const FLAG_OFFSET = 0x1F1E6 - 65; // regional-indicator base
const flagOf = cc => /^[A-Z]{2}$/.test(cc)
  ? String.fromCodePoint(...[...cc].map(c => c.charCodeAt(0) + FLAG_OFFSET)) : '🌍';

// ── IP → country cache + lookup ──────────────────────────────────────────────
const ipCache = new Map();          // ip → { cc, at }
const IP_TTL = 24 * 3600 * 1000;    // 24h
const IP_CACHE_MAX = 5000;
const inflight = new Map();         // dedupe concurrent lookups per IP

function cacheGet(ip) {
  const hit = ipCache.get(ip);
  if (hit && Date.now() - hit.at < IP_TTL) return hit.cc;
  if (hit) ipCache.delete(ip);
  return null;
}
function cacheSet(ip, cc) {
  if (ipCache.size >= IP_CACHE_MAX) ipCache.delete(ipCache.keys().next().value);
  ipCache.set(ip, { cc, at: Date.now() });
}

function fetchJson(url, timeoutMs = 2500) {
  return new Promise(resolve => {
    const req = https.get(url, { timeout: timeoutMs }, r => {
      let buf = '';
      r.on('data', c => buf += c);
      r.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc00:|fe80:)/i;
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xff || req.socket?.remoteAddress || '';
  return ip.replace(/^::ffff:/i, '');
}

// Best-effort IP→country. Resolves fast (2.5s cap); on failure returns null
// so the caller falls back to the default. Never throws.
async function countryFromIp(ip) {
  if (!ip || PRIVATE_IP.test(ip)) return null;
  const cached = cacheGet(ip);
  if (cached) return cached;
  if (inflight.has(ip)) return inflight.get(ip);
  const p = (async () => {
    const d = await fetchJson(`https://ipapi.co/${encodeURIComponent(ip)}/country/`);
    const cc = d && typeof d === 'string' ? d.trim().toUpperCase() : (d && d.country ? String(d.country).toUpperCase() : null);
    if (cc && /^[A-Z]{2}$/.test(cc)) cacheSet(ip, cc);
    inflight.delete(ip);
    return cc;
  })();
  inflight.set(ip, p);
  return p;
}

// ── Public API ───────────────────────────────────────────────────────────────
function countryFromHeaders(req) {
  const hdr = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country']
    || req.headers['x-country-code'] || req.headers['fastly-client-country'] || '';
  const cc = String(hdr).toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

// Cache check without triggering a lookup (for reporting detection source).
function cachePeek(ip) {
  return cacheGet(ip);
}

// Sync snapshot: headers → cache → default. Good enough for the middleware.
function detectSync(req) {
  const cc = countryFromHeaders(req) || cacheGet(clientIp(req)) || DEFAULT_COUNTRY;
  return profile(cc);
}

// Full detection: header → cache → live IP lookup → default.
async function detect(req) {
  let cc = countryFromHeaders(req) || cacheGet(clientIp(req));
  if (!cc) cc = (await countryFromIp(clientIp(req))) || DEFAULT_COUNTRY;
  return profile(cc);
}

function profile(cc) {
  const code = /^[A-Z]{2}$/.test(cc) ? cc : DEFAULT_COUNTRY;
  const c = COUNTRIES[code] || { name: code, currency: 'USD', langs: ['en'] };
  const currency = SYMBOLS[c.currency] ? c.currency : 'USD';
  return {
    country: code,
    countryName: c.name,
    flag: flagOf(code),
    currency,
    currencySymbol: SYMBOLS[currency] || currency,
    languages: c.langs,
  };
}

module.exports = { COUNTRIES, SYMBOLS, flagOf, detect, detectSync, countryFromHeaders, clientIp, cachePeek, profile };
