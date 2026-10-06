'use strict';
/**
 * FX — currency conversion with a process-lifetime cache.
 *
 * Rates come from open.er-api.com (free, no key). One live fetch per day per
 * process; all other conversions are local math. Falls back to a small static
 * table when the network is unavailable, so pricing UI never breaks on a
 * shared host with no outbound net.
 */
const https = require('https');

const SYMBOLS = { USD:'$', EUR:'€', GBP:'£', NGN:'₦', GHS:'GH₵', KES:'KSh', ZAR:'R',
  EGP:'E£', MAD:'DH', AED:'د.إ', SAR:'﷼', INR:'₹', CNY:'¥', JPY:'¥', BRL:'R$',
  XOF:'CFA', XAF:'FCFA', TZS:'TSh', UGX:'USh', RWF:'RF', ETB:'Br', GMD:'D', ZMW:'K',
  CAD:'CA$', AUD:'A$', ZWG:'Z$', TRY:'₺', QAR:'QR', KRW:'₩', MXN:'MX$', RUB:'₽',
  ILS:'₪', CHF:'CHF', SEK:'kr', NOK:'kr', DKK:'kr', PLN:'zł', THB:'฿', SGD:'S$',
  HKD:'HK$', NZD:'NZ$', ZWL:'Z$', SLE:'Le', LRD:'L$', MZN:'MT', BWP:'P', MUR:'₨',
  IDR:'Rp', MYR:'RM', PHP:'₱', VND:'₫', PKR:'Rs', BDT:'৳', LKR:'Rs', NPR:'Rs',
  UAH:'₴', RON:'lei', CZK:'Kč', HUF:'Ft', JMD:'J$', TTD:'TT$', BBD:'Bds$', DOP:'RD$', COP:'COL$', PEN:'S/', CLP:'CLP$' };

// Zero-decimal currencies (values are whole units — never show cents).
const ZERO_DECIMAL = new Set(['JPY','KRW','XOF','XAF','XPF','UGX','RWF','VND','CLP','ISK','CVE','DJF','GNF','KMF','MGA','BIF','TND','IQD','IRR','OMR','LYD','KWD','BHD','JOD','MUR','MVR']);

// Static fallback (approx, Sep 2026) — only used when the live fetch fails.
const FALLBACK_RATES = { USD:1, EUR:0.92, GBP:0.79, NGN:1480, GHS:15.2, KES:129,
  ZAR:18.2, EGP:48.5, MAD:9.9, AED:3.67, SAR:3.75, INR:83.5, CNY:7.2, JPY:150,
  BRL:5.4, XOF:604, XAF:604, TZS:2600, UGX:3700, RWF:1300, ETB:57, GMD:68,
  ZMW:26, CAD:1.36, AUD:1.5, TRY:34, QAR:3.64, KRW:1340, MXN:19.8, RUB:92,
  ILS:3.7, CHF:0.88, ZWG:26.5, SLE:22.5, LRD:194, MZN:63.9, BWP:13.7, MUR:46.5,
  IDR:15800, MYR:4.4, PHP:58, VND:25400, PKR:278, BDT:118, LKR:300, NPR:133,
  UAH:41, RON:4.6, CZK:23, HUF:370, COP:4100, PEN:3.8, CLP:950,
  JMD:157, TTD:6.8, BBD:2, DOP:60 };

let cache = { rates: FALLBACK_RATES, fetchedAt: 0, live: false };

function fetchJson(url, timeoutMs = 4000) {
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

async function refreshRates() {
  const d = await fetchJson('https://open.er-api.com/v6/latest/USD');
  if (d && d.result === 'success' && d.rates && d.rates.USD === 1) {
    cache = { rates: { ...FALLBACK_RATES, ...d.rates }, fetchedAt: Date.now(), live: true };
  } else {
    cache.fetchedAt = Date.now(); // retry within TTL even if this attempt failed
  }
}

// Warm the cache at boot and refresh daily. Fire-and-forget by design.
function startFx() {
  refreshRates();
  setInterval(refreshRates, 24 * 3600 * 1000).unref();
}

function decimalsFor(currency, value) {
  if (ZERO_DECIMAL.has(currency)) return 0;
  if (value >= 1000) return 0; // ₦74,000 not ₦74,000.00 — large denominations read cleaner
  return 2;
}

// Convert a USD amount into the target currency.
function fromUSD(usd, currency = 'USD') {
  const rate = cache.rates[currency] || (currency === 'USD' ? 1 : null);
  if (!rate || !Number.isFinite(usd)) return null;
  const v = usd * rate;
  const dec = decimalsFor(currency, v);
  return dec === 0 ? Math.round(v) : Math.round(v * 100) / 100;
}

// Format with the right symbol + rounding (e.g. ₦74,000 or €92.10).
function fmtUSD(usd, currency = 'USD') {
  const rate = cache.rates[currency] || 1;
  const sym = SYMBOLS[currency] || currency + ' ';
  const v = (Number(usd) || 0) * rate;
  const dec = decimalsFor(currency, v);
  const shown = v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return `${sym}${shown}`;
}

function status() {
  return { live: cache.live, fetchedAt: cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
    rates: Object.keys(cache.rates).length, currencies: Object.keys(SYMBOLS).length };
}

// Rate map for client-side conversion (fx.js keeps it fresh daily).
function ratesSnapshot() {
  const { ...out } = {};
  for (const k of Object.keys(SYMBOLS)) if (cache.rates[k] !== undefined) out[k] = cache.rates[k];
  out.USD = 1;
  return out;
}

module.exports = { SYMBOLS, ZERO_DECIMAL, startFx, refreshRates, fromUSD, fmtUSD, status, ratesSnapshot };
