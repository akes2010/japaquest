'use strict';
/**
 * Japa+ landing-page concierge.
 * Answers common travel/visa questions from the verified database — no AI key
 * required, rate-limited, and always points users to sign up for the full AI.
 */
const router = require('express').Router();
const { Q } = require('../db');
const { matchServices, renderRecs, getEffectivePartners } = require('../ai/affiliates');

const MODEL_ALIASES = {
  'deepseek': 'DeepSeek R1', 'qwen': 'Qwen 2.5 72B', 'llama': 'Llama 3.3 70B',
  'gemma': 'Gemma 3 27B', 'mistral': 'Mistral 7B', 'llama-groq': 'Llama 70B (Groq)',
  'gemini-flash': 'Gemini 1.5 Flash', 'claude': 'Claude Sonnet 4', 'openai': 'GPT-4o',
};

function parseCode(input) {
  const s = String(input || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

function parseBudget(text) {
  const m = String(text || '').match(/(\$|usd\s*)?(\d[\d,]{2,})(\s*usd|\s*dollars?|\$)?/i);
  return m ? parseInt(m[2].replace(/,/g, '')) : null;
}

function parseDays(text) {
  const m = String(text || '').toLowerCase().match(/(\d+)\s*(day|week)/);
  if (!m) return 7;
  return m[2] === 'week' ? Math.min(30, parseInt(m[1]) * 7) : Math.min(30, parseInt(m[1]));
}

function detectPassport(text, user) {
  const low = String(text || '').toLowerCase();
  for (const [code, demonym] of Object.entries({
    NG: ['nigerian', 'nigeria'], GH: ['ghanaian', 'ghana'], KE: ['kenyan', 'kenya'],
    ZA: ['south african', 'south africa'], ET: ['ethiopian', 'ethiopia'],
    CM: ['cameroonian', 'cameroon'], TZ: ['tanzanian', 'tanzania'],
    UG: ['ugandan', 'uganda'], SN: ['senegalese', 'senegal'],
  })) {
    if (demonym.some(d => low.includes(d))) return code;
  }
  return user?.passport_code || 'NG';
}

// City & colloquial aliases → seeded destination names
const DEST_ALIASES = {
  'United Arab Emirates': ['dubai', 'abu dhabi', 'uae', 'emirates'],
  'United Kingdom': ['uk', 'britain', 'england', 'london', 'scotland', 'wales'],
  'United States': ['usa', 'us', 'america', 'new york', 'washington', 'atlanta', 'houston', 'texas'],
  'Kenya': ['nairobi', 'mombasa'],
  'Ghana': ['accra', 'kumasi', 'tamale'],
  'South Africa': ['joburg', 'johannesburg', 'cape town', 'durban', 'pretoria'],
  'Egypt': ['cairo', 'alexandria', 'giza'],
  'Morocco': ['casablanca', 'marrakech', 'marrakesh', 'rabat'],
  'Rwanda': ['kigali'],
  'Senegal': ['dakar'],
  'Benin': ['cotonou'],
  'France': ['paris'],
  'Germany': ['berlin', 'munich', 'frankfurt'],
  'Canada': ['toronto', 'ottawa', 'vancouver', 'calgary'],
  'Qatar': ['doha'],
  'Ethiopia': ['addis ababa', 'addis'],
  'Tanzania': ['dar es salaam', 'zanzibar', 'dodoma'],
  'Uganda': ['kampala'],
  'Cameroon': ['douala', 'yaounde', 'yaoundé'],
  'Barbados': ['bridgetown'],
  'Seychelles': ['mahe', 'mahé'],
};

// Popular countries we have NO verified rules for — never guess these
const KEY_ALIASES = {
  Turkey: ['turkey', 'türkiye', 'turkiye', 'istanbul', 'ankara'],
  India: ['india', 'delhi', 'mumbai', 'bangalore'],
  China: ['china', 'beijing', 'shanghai', 'guangzhou'],
  Brazil: ['brazil', 'sao paulo', 'são paulo', 'rio'],
  Japan: ['japan', 'tokyo', 'osaka'],
  Australia: ['australia', 'sydney', 'melbourne'],
  Malaysia: ['malaysia', 'kuala lumpur'],
  Thailand: ['thailand', 'bangkok', 'phuket'],
  Indonesia: ['indonesia', 'bali', 'jakarta'],
  Ireland: ['ireland', 'dublin'],
  Italy: ['italy', 'rome', 'milan'],
  Spain: ['spain', 'madrid', 'barcelona'],
  Netherlands: ['netherlands', 'holland', 'amsterdam'],
  Poland: ['poland', 'warsaw'],
  'Saudi Arabia': ['saudi', 'riyadh', 'jeddah'],
  Kuwait: ['kuwait'],
  Oman: ['oman', 'muscat'],
  'South Korea': ['seoul'],
  Mexico: ['mexico', 'cancun'],
};

const rx = a => new RegExp('\\b' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');

function detectDestination(text, excludeCode) {
  const low = String(text || '').toLowerCase();
  const dests = Q.getDestinations();
  // 1. Exact country names
  let hit = dests.find(d => low.includes(d.name.toLowerCase()) && d.code !== excludeCode);
  if (hit) return hit;
  // 2. City / colloquial aliases (word-boundary match)
  for (const d of dests) {
    if (d.code === excludeCode) continue;
    const aliases = DEST_ALIASES[d.name] || [];
    if (aliases.some(a => rx(a).test(low))) return d;
  }
  return null;
}

function statusLine(status) {
  const L = {
    visa_free: 'Visa-free', voa: 'Visa on arrival', evisa: 'eVisa',
    eta: 'eTA (electronic travel authorisation)', visa_required: 'Visa required',
    needs_verification: 'Needs verification',
  };
  return L[status] || 'Needs verification';
}

function fmtFee(fees) {
  const f = fees || {};
  return f.amount && f.amount !== 'Varies' ? f.amount : null;
}

// ── Intent handlers ──────────────────────────────────────────────────────────
function answerVisa(text, passport, dest) {
  const data = Q.getVisaRule(passport, dest.code, 'Tourism');
  if (!data || !data.ver) {
    return `I don't have a verified record for **${passport} → ${dest.name}** yet. I'd rather say that honestly than guess — check the embassy's official site, or ask me about one of the ${Q.getDestinations().length} destinations I do have verified data for.`;
  }
  const { rule, ver } = data;
  const conditions = JSON.parse(ver.conditions_json || '[]');
  const fee = fmtFee(JSON.parse(ver.fees_json || '{}'));
  const lines = [
    `**${rule.passport_code} passport → ${dest.flag} ${dest.name}**`,
    `Status: **${statusLine(ver.status)}**` + (ver.max_stay && ver.max_stay !== '—' ? ` · up to ${ver.max_stay}` : ''),
  ];
  if (fee) lines.push(`Fee: **${fee}**`);
  if (ver.processing_days && ver.processing_days !== '—') lines.push(`Processing: ${ver.processing_days}`);
  if (conditions.length) lines.push(`Key requirements: ${conditions.slice(0, 4).join(' · ')}`);
  if (ver.source_authority) lines.push(`Source: ${ver.source_authority}${ver.verified_at ? ` (verified ${String(ver.verified_at).slice(0, 10)})` : ''}`);
  return lines.join('\n');
}

function answerFreeCountries(passport) {
  const rules = Q.getVisaRulesForPassport(passport, 'Tourism');
  const free = rules.filter(r => r.status === 'visa_free' || r.status === 'voa');
  if (!free.length) {
    return `I don't have visa-free records for **${passport}** yet — but I have ${rules.length} verified destinations for it. Ask me about any specific country.`;
  }
  const parts = free.map(r => `${r.dest_flag} **${r.dest_name}** (${r.status === 'voa' ? 'on arrival' : 'visa-free'}${r.max_stay ? `, ${r.max_stay}` : ''})`);
  return `With a **${passport}** passport you can walk in (or grab a visa on arrival) at:\n${parts.join('\n')}\n\nWant fees, documents, or budgets for any of these? Just ask.`;
}

function answerBudget(text, dest) {
  const days = parseDays(text);
  const base = dest.avg_daily_budget_usd || 80;
  const style = /luxur|premium|fanc/i.test(text) ? 2.5 : /backpack|cheap|budget/i.test(text) ? 0.6 : 1;
  const total = Math.round(base * style * days);
  const lines = [
    `**${days} days in ${dest.flag} ${dest.name}** — roughly **$${total.toLocaleString()}** excluding flights.`,
    `Per day: ~$${Math.round(base * style)} (${style < 1 ? 'backpacker' : style > 1 ? 'comfortable/luxury' : 'mid-range'} style).`,
  ];
  lines.push(`Breakdown: 🏨 stay ~$${Math.round(base * style * 0.35 * days)} · 🍽 food ~$${Math.round(base * style * 0.25 * days)} · 🚌 transport ~$${Math.round(base * style * 0.2 * days)} · 🎟 activities ~$${Math.round(base * style * 0.1 * days)} · 🛍 misc ~$${Math.round(base * style * 0.1 * days)}`);
  return lines.join('\n');
}

// Budgets exclude flights — add a tracked flight-search suggestion
function withFlightHint(budgetReply, dest) {
  const flight = matchServices('flights');
  return budgetReply + renderRecs([
    ...(flight || []),
    ...matchServices(`airport transfer esim ${dest?.name || ''}`),
  ].slice(0, 3));
}

// After answering "can I enter", surface the services they'll need next
function withArrivalExtras(reply, dest) {
  return reply + renderRecs(matchServices(`airport transfer esim ${dest?.name || ''}`));
}

// Direct "book X / where can I rent a car / need an eSIM" style requests
function answerServices(text, dest) {
  const partners = matchServices(text);
  if (!partners.length) return null;
  const intro = dest
    ? `For **${dest.flag} ${dest.name}**, here's who I'd use:`
    : `Here's who I'd book with — every traveller favourite in one place:`;
  const lines = partners.map(p => `🔗 **${p.icon} ${p.name} — ${p.tag}**: ${p.blurb} — book: [${p.name}](${p.url})`);
  const askLine = dest
    ? `\n\nWant me to work any of these into a full plan for your ${dest.name} trip? Just ask.`
    : `\n\nTell me your destination and I'll match the right services to your trip.`;
  return `${intro}\n${lines.join('\n')}${askLine}`;
}

function answerBestTime(dest) {
  if (!dest.best_months) return `I don't have seasonality data for ${dest.name} yet — but ask me about visas or budgets and I'll ground those in the database.`;
  return `Best months for **${dest.flag} ${dest.name}**: **${dest.best_months}**. Shoulder months around those windows usually mean fewer crowds and softer prices.`;
}

function answerGreeting(name) {
  const n = Q.getDestinations().length;
  const p = Q.getPassports().length;
  return `Hey${name ? ' ' + name : ''}! 👋 I'm the Japa+ concierge. I can tell you visa requirements for your passport, where you can go visa-free, trip budgets, and the best months to travel — grounded in our verified database of **${n} destinations** across **${p} African passports**.\n\nTry: *"Do I need a visa for Turkey?"* or *"Where can Nigerians go visa-free?"*`;
}

function answerHelp() {
  return `Here's what I can answer right now:\n• **Visa checks** — "Do I need a visa for the UK with a Nigerian passport?"\n• **Visa-free lists** — "Where can Ghanaians go visa-free?"\n• **Trip budgets** — "Budget for 10 days in Dubai?"\n• **Best season** — "When is the best time to visit Kenya?"\n\nFor full step-by-step guides, embassy-ready letters and AI trip planning, **create a free account** — that's where the 9 AI models come in.`;
}

// ── GET /api/chat/partners — public one-place partner directory ─────────────
router.get('/partners', (_req, res) => {
  const partners = Object.values(getEffectivePartners())
    .filter(p => p.enabled !== false && (p.keywords || []).length)
    .map(p => ({ id: p.id, name: p.name, icon: p.icon, tag: p.tag, type: p.type, url: p.url, blurb: p.blurb }));
  res.json({ partners });
});

// ── GET /api/chat/affiliate-click — fire-and-forget partner click beacon ────
router.get('/affiliate-click', (_req, res) => res.status(204).end());

// ── POST /api/chat/affiliate-click — log partner clicks from the landing chat ─
router.post('/affiliate-click', (req, res) => {
  const partner = String(req.body?.partner || 'unknown').slice(0, 60);
  const url = String(req.body?.url || '').slice(0, 300);
  console.log(`[affiliate-click] ${partner} ${url}`);
  res.status(204).end();
});

// ── POST /api/chat — public concierge ────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const text = String(req.body?.message || '').slice(0, 500);
    if (!text.trim()) return res.status(400).json({ error: 'Message required' });

    // Attach user context if a valid token is present (optional auth)
    let user = null;
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
      try {
        const payload = require('../middleware/auth').verifyToken(auth.slice(7));
        if (payload) user = Q.getUserByUUID(payload.uuid);
      } catch {}
    }

    const low = text.toLowerCase();
    let passport = detectPassport(text, user);

    // Greetings & help
    if (/^(hi|hello|hey|good (morning|afternoon|evening)|yo|sup)\b/.test(low)) {
      return res.json({ reply: answerGreeting(user?.name), suggestions: ['Where can Nigerians go visa-free?', 'Do I need a visa for Turkey?', 'Budget for 7 days in Nairobi?'] });
    }
    if (/(what can you do|help|how does this work|who are you|what is this)/.test(low)) {
      return res.json({ reply: answerHelp(), suggestions: ['Do I need a visa for the UK?', 'Where can Kenyans go visa-free?', 'Budget for 10 days in Dubai?'] });
    }

    // Service / booking intent — flights, cars, transfers, eSIMs, insurance,
    // luggage, activities, compensation: match to Travelpayouts partners first.
    // (Runs before `dest` is declared, so resolve the destination locally.)
    // matchServices returns [] for non-service messages, so visa/budget
    // questions pass straight through.
    {
      const svcDest = detectDestination(text, null);
      const svc = answerServices(text, svcDest);
      if (svc) return res.json({ reply: svc, suggestions: svcDest ? ['Do I need a visa for ' + svcDest.name + '?', 'Budget for 7 days in ' + svcDest.name + '?'] : ['Where can ' + passport + ' passport holders go visa-free?', 'Budget for 7 days in Dubai?'] });
    }

    // Visa-free / "where can X go" intent — resolve BEFORE destination detection,
    // or the passport country gets excluded and the question falls through
    if (/(visa.?free|without a visa|no visa|where can .* go|travel to without)/.test(low)) {
      const target = detectDestination(text, passport);
      // "Is Kenya visa-free for Nigerians?" → answer the specific rule
      if (target) return res.json({ reply: answerVisa(text, passport, target), suggestions: ['Budget for 7 days in ' + target.name + '?', 'Where can ' + passport + ' passport holders go visa-free?'] });
      return res.json({ reply: answerFreeCountries(passport), suggestions: ['Budget for 7 days in Nairobi?', 'Do I need a visa for the UK?', 'Best time to visit Kenya?'] });
    }

    let dest = detectDestination(text, passport);
    if (!dest) {
      // The only country mentioned may be the destination itself
      // ("Best time to visit Ghana?" written by a Ghanaian) — don't exclude it
      dest = detectDestination(text, null);
      if (dest && dest.code === passport) passport = user?.passport_code || 'NG';
    }

    // Well-known country with no verified rules yet — say so honestly
    if (!dest && /(visa|entry|enter|passport|travel|visit|fly|move to|go to)/.test(low)) {
      for (const [country, aliases] of Object.entries(KEY_ALIASES)) {
        if (aliases.some(a => rx(a).test(low))) {
          return res.json({
            reply: `I don't have verified **${passport} → ${country}** visa data yet — and for something this important, I won't guess. Check ${country}'s official embassy or e-visa portal for your passport type.\n\nMeanwhile I have verified, sourced data for ${Q.getDestinations().length} destinations — UK, UAE, Qatar, Kenya, Rwanda and more. Ask me about any of those!` + renderRecs(matchServices('airport transfer esim insurance')),
            suggestions: ['Do I need a visa for the UK?', 'Where can ' + passport + ' passport holders go visa-free?', 'Budget for 7 days in Dubai?'],
          });
        }
      }
    }

    if (dest) {
      // Budget intent — budgets exclude flights, so surface a flight-search partner
      if (/(budget|cost|how much|afford|expenses)/.test(low)) {
        return res.json({ reply: withFlightHint(answerBudget(text, dest), dest), suggestions: ['Do I need a visa for ' + dest.name + '?', 'Best time to visit ' + dest.name + '?'] });
      }
      // Best time intent
      if (/(best time|when should|season|weather|month)/.test(low)) {
        return res.json({ reply: withArrivalExtras(answerBestTime(dest), dest), suggestions: ['Budget for 7 days in ' + dest.name + '?', 'Do I need a visa for ' + dest.name + '?'] });
      }
      // Visa intent (explicit or implied by mentioning a destination)
      if (/(visa|entry|enter|allowed|passport)/.test(low) || !/(flight|hotel|stay)/.test(low)) {
        return res.json({ reply: withArrivalExtras(answerVisa(text, passport, dest), dest), suggestions: ['Budget for 7 days in ' + dest.name + '?', 'Where can ' + passport + ' passport holders go visa-free?'] });
      }
    }

    // Fallback
    return res.json({
      reply: `I'm the visa & trip-planning concierge, so I'm sharpest on **visas, visa-free lists, budgets and seasons**. ${dest ? '' : 'Name a destination (like "Dubai" or "UK") ' }and I'll pull the verified numbers for your passport.\n\nFor full AI trip planning with 9 models, create a free account — takes 30 seconds.`,
      suggestions: ['Where can Nigerians go visa-free?', 'Do I need a visa for Turkey?', 'Budget for 10 days in Dubai?'],
    });
  } catch (e) {
    console.error('[chat]', e.message);
    res.status(500).json({ error: 'Concierge hit a snag. Try again.' });
  }
});

module.exports = router;
