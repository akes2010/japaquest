'use strict';
/**
 * Travelpayouts affiliate partner registry — single source of truth.
 *
 * Every partner is your tracked TPX short link. When a traveller's chat
 * message matches a partner's keywords, the concierge and AI models surface
 * the exact tracked URL so they can book everything in one place.
 *
 * To add/replace a partner: edit PARTNERS only — chat, AI prompts and the
 * dashboard pick the change up automatically.
 */

const PARTNERS = {
  aviasales: {
    name: 'Aviasales', icon: '✈️', tag: 'Flights', type: 'flight',
    url: 'https://aviasales.tpx.lu/ZsU7v9Ss',
    blurb: 'compare airline fares and grab the cheapest flight dates',
    keywords: ['flight', 'flights', 'fly', 'flying', 'airline', 'airlines', 'airfare', 'air ticket', 'plane', 'ticket to', 'aviasales'],
  },
  economybookings: {
    name: 'EconomyBookings', icon: '🚗', tag: 'Car rental', type: 'car',
    url: 'https://economybookings.tpx.lu/ycRJnuRe',
    blurb: 'rent a car at great rates from 900+ providers worldwide',
    keywords: ['car', 'car rental', 'rent a car', 'rental', 'drive', 'driving', 'self drive', 'road trip', 'economybookings', 'hire a car', 'car hire'],
  },
  getrentacar: {
    name: 'GetRentacar', icon: '🚙', tag: 'Car rental', type: 'car',
    url: 'https://getrentacar.tpx.lu/xuRWmeVH',
    blurb: 'book local car rentals with flexible pickup and free cancellation',
    keywords: ['getrentacar', 'local car rental', 'cheap car rental', 'car for a day', 'car for a week'],
  },
  localrent: {
    name: 'LocalRent', icon: '🚕', tag: 'Car rental', type: 'car',
    url: 'https://localrent.tpx.lu/r4Rcz9Ns',
    blurb: 'rent from trusted local companies — often cheaper than big brands',
    keywords: ['localrent', 'local rental', 'local car hire'],
  },
  qeeq: {
    name: 'Qeeq', icon: '🚘', tag: 'Car rental', type: 'car',
    url: 'https://qeeq.tpx.lu/LnBVksGJ',
    blurb: 'compare car rental deals with price-drop protection',
    keywords: ['qeeq', 'car deals', 'rental deals'],
  },
  klook: {
    name: 'Klook', icon: '🎟️', tag: 'Activities', type: 'activity',
    url: 'https://klook.tpx.lu/BgRd8Wt7',
    blurb: 'book tours, attraction tickets and experiences up front',
    keywords: ['klook', 'tour', 'tours', 'activity', 'activities', 'attraction', 'attractions', 'things to do', 'sightseeing', 'museum', 'theme park', 'safari', 'excursion'],
  },
  kkday: {
    name: 'KKday', icon: '🗺️', tag: 'Activities', type: 'activity',
    url: 'https://kkday.tpx.lu/pxCuzgM1',
    blurb: 'discover unique local experiences and day trips',
    keywords: ['kkday', 'experience', 'experiences', 'day trip', 'day trips', 'local experience'],
  },
  wegotrip: {
    name: 'WeGoTrip', icon: '🎧', tag: 'Activities', type: 'activity',
    url: 'https://wegotrip.tpx.lu/sVLx3daE',
    blurb: 'download self-guided audio tours you can take at your own pace',
    keywords: ['wegotrip', 'audio tour', 'audio guide', 'self guided', 'walking tour', 'guided tour'],
  },
  intui: {
    name: 'Intui', icon: '🎡', tag: 'Activities', type: 'activity',
    url: 'https://intui.tpx.lu/QD2b766T',
    blurb: 'skip the line with pre-booked excursions and attraction passes',
    keywords: ['intui', 'excursion', 'excursions', 'skip the line', 'pass'],
  },
  kiwitaxi: {
    name: 'Kiwitaxi', icon: '🚐', tag: 'Transfers', type: 'transfer',
    url: 'https://kiwitaxi.tpx.lu/zvm8646y',
    blurb: 'pre-book a fixed-price airport transfer so no driver overcharges you',
    keywords: ['kiwitaxi', 'transfer', 'transfers', 'airport transfer', 'pick up', 'pickup', 'taxi', 'cab', 'shuttle', 'how to get from the airport', 'from the airport to'],
  },
  airalo: {
    name: 'Airalo', icon: '📶', tag: 'eSIM', type: 'esim',
    url: 'https://airalo.tpx.lu/up2zoaEK',
    blurb: 'install an eSIM before you fly and get data the moment you land',
    keywords: ['airalo', 'esim', 'e-sim', 'sim card', 'sim', 'data plan', 'data abroad', 'internet abroad', 'mobile data', 'roaming', 'connectivity', 'stay connected', 'internet access'],
  },
  saily: {
    name: 'Saily', icon: '📱', tag: 'eSIM', type: 'esim',
    url: 'https://saily.tpx.lu/wjfc4A8S',
    blurb: 'affordable travel eSIM plans in 190+ countries',
    keywords: ['saily', 'saily esim'],
  },
  yesim: {
    name: 'Yesim', icon: '🌐', tag: 'eSIM', type: 'esim',
    url: 'https://yesim.tpx.lu/nE5kYGSU',
    blurb: 'unlimited-data eSIM options for heavy streaming and maps',
    keywords: ['yesim', 'unlimited data'],
  },
  drimsim: {
    name: 'Drimsim', icon: '📡', tag: 'eSIM', type: 'esim',
    url: 'https://drimsim.tpx.lu/3KqtWOaK',
    blurb: 'one universal SIM that works in 197 countries',
    keywords: ['drimsim', 'universal sim', 'physical sim'],
  },
  radicalstorage: {
    name: 'Radical Storage', icon: '🧳', tag: 'Luggage', type: 'luggage',
    url: 'https://radicalstorage.tpx.lu/pS5ImOJB',
    blurb: 'drop your bags at a nearby luggage point and explore hands-free',
    keywords: ['radical storage', 'luggage', 'baggage', 'bags', 'store my bag', 'left luggage', 'locker', 'luggage storage'],
  },
  airhelp: {
    name: 'AirHelp', icon: '🛡️', tag: 'Compensation', type: 'insurance',
    url: 'https://airhelp.tpx.lu/jfoFhmLR',
    blurb: 'claim up to $700 compensation if your flight is delayed or cancelled',
    keywords: ['airhelp', 'compensation', 'delay', 'delayed', 'flight delay', 'delayed flight', 'cancelled flight', 'canceled flight', 'denied boarding', 'overbooked', 'flight refund', 'delay compensation', 'stuck at the airport'],
  },
  ektatraveling: {
    name: 'Ekta Traveling', icon: '🧾', tag: 'Insurance', type: 'insurance',
    url: 'https://ektatraveling.tpx.lu/gfoRLO4G',
    blurb: 'travel insurance that covers visas, medicals and baggage from $1/day',
    keywords: ['ekta', 'ektatraveling', 'insurance', 'insure', 'travel cover', 'medical cover', 'schengen insurance'],
  },
  welcomepickups: {
    name: 'Welcome Pickups', icon: '🤝', tag: 'Transfers', type: 'transfer',
    url: 'https://tpx.lu/YWXpQxKb',
    blurb: 'airport meet-and-greet with a local English-speaking driver, flight tracked',
    keywords: ['welcome pickups', 'meet and greet', 'english speaking driver', 'private pickup', 'welcomepickup', 'greeted at the airport', 'flight tracked pickup'],
  },
};

/** Max partner recommendations injected into one chat reply. */
const MAX_RECS = 3;

// ── ADMIN OVERRIDES (settings table, group 'affiliates') ─────────────────────
// Admin panel edits are stored as aff_partner_<id> JSON rows and merged over
// the defaults above, so links can be changed without touching code or
// restarting. Deleted partners are stored as JSON null and hidden.
const OVERRIDE_PREFIX = 'aff_partner_';
let _cache = { at: 0, partners: null };

function getOverrides() {
  try {
    const { Q } = require('../db');
    // getSettingsByGroup returns { key: value } — values are JSON strings
    const map = Q.getSettingsByGroup('affiliates') || {};
    const out = {};
    for (const [key, value] of Object.entries(map)) {
      if (!key.startsWith(OVERRIDE_PREFIX)) continue;
      try { out[key.slice(OVERRIDE_PREFIX.length)] = JSON.parse(value); } catch {}
    }
    return out;
  } catch { return {}; }
}

/** Defaults merged with admin overrides — used by chat, AI prompts and admin. */
function getEffectivePartners() {
  const now = Date.now();
  if (_cache.partners && now - _cache.at < 15000) return _cache.partners;
  const merged = {};
  for (const [id, p] of Object.entries(PARTNERS)) merged[id] = { ...p, id };
  for (const [id, o] of Object.entries(getOverrides())) {
    if (o === null) { delete merged[id]; continue; }
    if (!merged[id]) {
      // Newly added partner from the admin panel
      if (!o.name || !o.url) continue;
      merged[id] = { icon: '🔗', tag: 'Travel', type: 'misc', blurb: '', keywords: [], ...o, id };
    } else {
      merged[id] = { ...merged[id], ...o, id, keywords: Array.isArray(o.keywords) ? o.keywords : merged[id].keywords };
    }
  }
  _cache = { at: now, partners: merged };
  return merged;
}

function clearPartnerCache() { _cache = { at: 0, partners: null }; }

// Whole-word keyword match (with optional plural) so 'car' never hits 'card'
// and 'sim' never hits 'simple'. Never throws on odd keyword input.
function kwRegex(kw) {
  const esc = String(kw).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const stem = esc.length > 4 && esc.endsWith('s') ? esc.slice(0, -1) : esc;
  return new RegExp('\\b' + stem + '(?:es|s)?\\b', 'i');
}

/**
 * Match a free-text travel question to affiliate partners via keywords.
 * Returns up to MAX_RECS partners, best match first. Never throws.
 */
function matchServices(text) {
  const low = String(text || '').toLowerCase();
  if (!low.trim()) return [];
  const scored = [];
  for (const p of Object.values(getEffectivePartners())) {
    if (p.enabled === false) continue;
    let score = 0;
    for (const kw of p.keywords || []) {
      if (kwRegex(kw).test(low)) score += kw.includes(' ') ? 3 : 2;
    }
    if (score > 0) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_RECS).map(s => s.p);
}

/** Render partner recommendations as chat-ready markdown lines. */
function renderRecs(partners) {
  if (!partners?.length) return '';
  const lines = partners.map(p => `🔗 **${p.icon} ${p.name} — ${p.tag}**: ${p.blurb} — book: [${p.name}](${p.url})`);
  return `\n\n🎁 **Book it in one place** (trusted partners — prices unchanged for you, Japa+ earns a small commission):\n${lines.join('\n')}`;
}

/** Full one-place partner directory for AI system prompts. */
function partnerDirectory() {
  return Object.values(getEffectivePartners())
    .filter(p => p.enabled !== false && (p.keywords || []).length)
    .map(p => `- ${p.icon} ${p.name} (${p.tag}): ${p.blurb} — link: ${p.url}`)
    .join('\n');
}

module.exports = { PARTNERS, matchServices, renderRecs, partnerDirectory, getOverrides, getEffectivePartners, clearPartnerCache, MAX_RECS };
