'use strict';
/**
 * JapaQuest Journey OS — the smart trip execution engine.
 *
 * This is what separates JapaQuest from search engines: it converts a verified
 * visa rule into a deadline-driven execution plan (checklist, timeline,
 * readiness score, pre-departure briefing) tailored to the traveller's
 * passport, purpose and dates — including first-trip-failure patterns that
 * forums never agree on.
 */
const { Q } = require('../db');

// ── Purpose templates ─────────────────────────────────────────────────────────
// Phases: research → documents → money → apply → book → pre-departure → on arrival
// offset_days = days before departure the task should START (negative = after landing).
const PURPOSE_TEMPLATES = {
  Tourism: [
    { phase: 'apply',    title: 'Apply for the visa',              offset: -45, detail: 'Submit as soon as your dates are fixed — never later than the stated processing time plus a 2-week buffer.' },
    { phase: 'documents',title: 'Passport valid 6+ months beyond return', offset: -90, detail: 'Renew first if it is not — most rejections happen here.' },
    { phase: 'documents',title: 'Book biometrics / appointment',    offset: -50, detail: 'Slots fill fast in Lagos, Accra and Nairobi — book the moment the visa window opens.' },
    { phase: 'money',    title: 'Build the bank statement pattern', offset: -90, detail: 'Salary credited monthly, healthy balance held steady for 3–6 months. No sudden lump sums before applying.' },
    { phase: 'money',    title: 'Buy travel insurance',             offset: -14, detail: 'Must cover the whole stay. Schengen requires €30,000 medical minimum.' },
    { phase: 'book',     title: 'Book refundable flight + hotel',   offset: -40, detail: 'Refundable bookings satisfy visa proof-of-accommodation without risking money if the visa is delayed.' },
    { phase: 'pre-departure', title: 'Print every document',        offset: -7,  detail: 'Print visa, insurance, bookings, bank statements, employment letter — and save offline PDF copies on your phone.' },
    { phase: 'on arrival',    title: 'Arrival formalities',         offset: 0,   detail: 'Keep return ticket, hotel address and funds evidence reachable on your phone for the immigration officer.' },
  ],
  Business: [
    { phase: 'documents', title: 'Get the invitation letter from host company', offset: -60, detail: 'On company letterhead, signed, stating purpose, dates and who covers costs.' },
    { phase: 'apply',     title: 'Apply for the business visa', offset: -45, detail: 'Attach invitation letter, company registration (CAC) and your employment letter.' },
    { phase: 'documents', title: 'Employment letter + payslips', offset: -60, detail: 'States your role, salary, approved leave and that your job remains while you travel.' },
    { phase: 'money',     title: 'Buy travel insurance', offset: -14, detail: 'Corporate trips still need medical cover — Schengen enforces €30,000.' },
    { phase: 'book',      title: 'Book flights and hotel near meeting venue', offset: -35, detail: 'Match dates exactly to the invitation letter — mismatches trigger questions.' },
    { phase: 'pre-departure', title: 'Pack business documents', offset: -5, detail: 'Printed invitations, contracts or decks, business cards. Keep a digital backup in cloud storage.' },
  ],
  Study: [
    { phase: 'research',  title: 'Confirm admission letter', offset: -180, detail: 'Unconditional offer, CAS (UK) or I-20 (US) in hand before anything else.' },
    { phase: 'documents', title: 'Pay tuition deposit / show proof of funds', offset: -120, detail: 'Funds must often be held 28+ consecutive days — plan the account early, not the week before.' },
    { phase: 'documents', title: 'Book English test (IELTS/TOEFL) if required', offset: -150, detail: 'Results take 3–13 days; leave time for one retake.' },
    { phase: 'apply',     title: 'Submit the student visa application', offset: -90, detail: 'Student queues are longest Aug–Sep and Jan — apply the moment your documents are complete.' },
    { phase: 'documents', title: 'Complete medicals / TB test', offset: -75, detail: 'Only at approved clinics; results can take 1–2 weeks.' },
    { phase: 'book',      title: 'Arrange student accommodation', offset: -60, detail: 'Many student visas require a confirmed address before arrival.' },
    { phase: 'pre-departure', title: 'Attend pre-departure briefing', offset: -10, detail: 'Know your reporting obligations, work-hour limits and what to declare at immigration.' },
  ],
  Work: [
    { phase: 'documents', title: 'Sign the employment contract', offset: -120, detail: 'Verify role, salary and who sponsors the visa. Never pay an agent for a job offer.' },
    { phase: 'documents', title: 'Employer secures work permit / sponsorship', offset: -110, detail: 'Certificate of Sponsorship (UK), LMIA (Canada), or the local equivalent — the employer usually drives this.' },
    { phase: 'documents', title: 'Get qualifications attested', offset: -90, detail: 'Degree certificates, professional licenses, police clearance — attestation can take weeks.' },
    { phase: 'apply',     title: 'Submit the work visa application', offset: -75, detail: 'Attach the permit/sponsorship number and every document the checklist names — work visas are document-exhaustive.' },
    { phase: 'book',      title: 'Plan relocation logistics', offset: -21, detail: 'Flights, first month accommodation, international driving permit if needed.' },
    { phase: 'pre-departure', title: 'Register for tax / social security on arrival plan', offset: 3, detail: 'Know what to register for in week one — it affects when you get paid.' },
  ],
  'Family Visit': [
    { phase: 'documents', title: 'Host sends invitation letter + status proof', offset: -60, detail: 'Invitation plus their passport/residence permit or utility bills proving legal residence.' },
    { phase: 'documents', title: 'Gather proof of relationship', offset: -55, detail: 'Birth/marriage certificates, photos, call logs — ties evidence matters for visit visas.' },
    { phase: 'apply',     title: 'Apply for the visit visa', offset: -45, detail: 'Include sponsor letter confirming accommodation and financial support.' },
    { phase: 'money',     title: 'Show funds or get sponsor undertaking', offset: -45, detail: 'Either your statements or the sponsor\'s — mixed funding confuses caseworkers.' },
    { phase: 'book',      title: 'Book flights for the exact invitation dates', offset: -30, detail: 'Overstaying a family visit damages both you and your host\'s future sponsorships.' },
    { phase: 'pre-departure', title: 'Save host\'s local address & phone offline', offset: -3, detail: 'Immigration will ask where you are staying — have it written, not just in email.' },
  ],
};

// Universal tasks appended to every trip
const UNIVERSAL_TASKS = [
  { phase: 'documents', title: 'Check passport issue date & blank pages', offset: -90, detail: 'Many countries require 2–4 blank pages and reject passports issued within the last 10 years (EU/Schengen rule).' },
  { phase: 'money', title: 'Set up travel money (card / eSIM data plan)', offset: -10, detail: 'Notify your bank, order a low-fee card, install an eSIM so you have data the moment you land.' },
  { phase: 'pre-departure', title: 'Check-in online & confirm terminal', offset: -1, detail: 'Saves queue time; confirms your booking is intact 24h before departure.' },
  { phase: 'pre-departure', title: 'Money + documents split pack', offset: -1, detail: 'Never carry everything in one bag: split cards and cash, keep documents on your person, not in checked luggage.' },
];

// ── Fee parsing ───────────────────────────────────────────────────────────────
function parseFeeUsd(feeJson) {
  try {
    const f = typeof feeJson === 'string' ? JSON.parse(feeJson || '{}') : (feeJson || {});
    const raw = String(f.amount ?? f.usd ?? '').trim();
    if (!raw || /varies|free|—/i.test(raw)) return raw.toLowerCase() === 'free' ? 0 : null;
    const m = raw.match(/([\d,]+(?:\.\d+)?)/);
    if (!m) return null;
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (/£/.test(raw)) n *= 1.27;        // approximate live conversion
    else if (/€/.test(raw)) n *= 1.08;
    else if (/CAD/i.test(raw)) n *= 0.73;
    return Math.round(n);
  } catch { return null; }
}

function parseProcessingDays(text) {
  const m = String(text || '').match(/(\d+)\s*[-–]\s*(\d+)/);
  if (m) return parseInt(m[2]); // conservative upper bound
  const s = String(text || '').match(/\d+/);
  return s ? parseInt(s[0]) : null;
}

function addDays(dateStr, days) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Checklist generation ──────────────────────────────────────────────────────
function buildChecklist(rule, journey) {
  const dep = journey?.departure_date || null;
  const tasks = [];
  const push = (t) => tasks.push({
    phase: t.phase, title: t.title, detail: t.detail || '',
    offset_days: t.offset ?? null,
    deadline: t.offset != null && dep ? addDays(dep, t.offset) : null,
    source: 'template',
  });

  const template = PURPOSE_TEMPLATES[journey?.purpose] || PURPOSE_TEMPLATES.Tourism;
  template.forEach(push);
  UNIVERSAL_TASKS.forEach(push);

  // Visa-rule-specific conditions become tasks
  let conditions = [];
  try { conditions = JSON.parse(rule?.ver?.conditions_json || '[]'); } catch {}
  for (const c of conditions.slice(0, 6)) {
    push({ phase: 'documents', title: `Requirement: ${String(c).slice(0, 120)}`, detail: `Source: ${rule?.ver?.source_authority || 'official source'}`, offset: -60 });
  }

  // First-trip failure patterns — the things forums never agree on
  const failures = [];
  if (rule?.ver?.processing_days) {
    const pd = parseProcessingDays(rule.ver.processing_days);
    if (pd) failures.push({ phase: 'apply', title: `Apply at least ${pd + 14} days before departure`, detail: `Official processing is ${rule.ver.processing_days}. Add a 2-week buffer for appointment backlogs and delays.`, offset: -(pd + 14) });
  }
  failures.push(
    { phase: 'money', title: 'No sudden large deposits before applying', detail: 'Caseworkers flag lump sums. Move money early and let the balance age; keep the paper trail for any big transfer.', offset: -75 },
    { phase: 'apply', title: 'Book the appointment slot the day applications open', detail: 'VFS/TLScontact slots in Lagos & Accra disappear within minutes. Set a reminder for release time.', offset: -60 },
    { phase: 'documents', title: 'Cross-check every date across documents', detail: 'Itinerary, hotel, insurance and employment letter dates must agree exactly — mismatches are a top silent rejection cause.', offset: -30 },
  );
  failures.forEach(push);

  // Deduplicate by title (case-insensitive), keeping first occurrence
  const seen = new Set();
  return tasks.filter(t => {
    const k = t.title.toLowerCase().slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// ── Readiness score ───────────────────────────────────────────────────────────
function computeReadiness(journey, tasks, docs = []) {
  const total = tasks.length || 1;
  const done  = tasks.filter(t => t.status === 'done').length;
  const completion = done / total;

  const today = new Date().toISOString().slice(0, 10);
  const overdue = tasks.filter(t => t.status !== 'done' && t.deadline && t.deadline < today).length;

  // Passport validity check from wallet
  let passportOk = true, passportMsg = 'Add your passport to the wallet to track validity';
  const pass = docs.find(d => d.doc_type === 'passport');
  if (pass && pass.expiry_date) {
    const monthsLeft = (new Date(pass.expiry_date) - new Date()) / (1000 * 60 * 60 * 24 * 30.4);
    if (monthsLeft < 6) { passportOk = false; passportMsg = `Passport expires in ${Math.max(0, Math.round(monthsLeft))} months — renew before applying (6-month rule)`; }
    else passportMsg = `Passport valid ${Math.round(monthsLeft)} more months`;
  }

  // Time to departure
  let daysToDeparture = null;
  if (journey?.departure_date) {
    daysToDeparture = Math.ceil((new Date(journey.departure_date) - new Date()) / (1000 * 60 * 60 * 24));
  }

  const overduePenalty = Math.min(25, overdue * 5);
  const passportPenalty = passportOk ? 0 : 20;
  const score = Math.max(0, Math.min(100, Math.round(completion * 100 - overduePenalty - passportPenalty)));

  let status = 'not_started';
  if (score >= 90) status = 'ready';
  else if (score >= 60) status = 'on_track';
  else if (score >= 25) status = 'needs_attention';
  else if (done > 0) status = 'behind';

  return { score, status, done, total, overdue, passportOk, passportMsg, daysToDeparture };
}

// ── Pre-departure briefing ────────────────────────────────────────────────────
function preDepartureBriefing(journey, docs = []) {
  // Resolve the traveller's passport from the journey owner (journeys don't store it)
  let passport = journey.passport_code || null;
  if (!passport && journey.user_id) {
    try { passport = Q.getUserById(journey.user_id)?.passport_code || null; } catch {}
  }
  const rule = passport && journey.destination_code
    ? Q.getVisaRule(passport, journey.destination_code, journey.purpose || 'Tourism')
    : null;
  // Note: rule may be null for journeys created without a matching seeded rule.
  let conditions = [];
  try { conditions = rule?.ver ? JSON.parse(rule.ver.conditions_json || '[]') : []; } catch {}

  const warnings = [];
  const tips = [];

  if (journey.days_to_departure != null) {
    if (journey.days_to_departure < 0) tips.push('You are travelling mid-journey — complete on-arrival tasks when you land.');
    else if (journey.days_to_departure <= 14 && !journey.visa_status?.match(/visa_free|voa/i))
      warnings.push(`Departure in ${journey.days_to_departure} days with status "${journey.visa_status || 'unknown'}" — confirm your visa is issued before booking non-refundable extras.`);
  }

  const pass = docs.find(d => d.doc_type === 'passport');
  if (pass?.expiry_date) {
    const monthsLeft = (new Date(pass.expiry_date) - new Date()) / (1000 * 60 * 60 * 24 * 30.4);
    if (monthsLeft < 6) warnings.push(`Passport has under 6 months validity — many airlines will deny boarding.`);
  }

  if (/visa_required|evisa|eta/i.test(journey.visa_status || '') && !journey.embassy_url)
    warnings.push('No official application URL on file — apply only via the official government website, never third-party "agents".');

  tips.push('Carry printed copies of everything; immigration officers can request them even with eVisas.');
  tips.push(`Budget note: ${journey.dest_name || journey.destination_code} averages $${journey.avg_daily_budget_usd || 80}/day — carry proof of funds for the full stay.`);
  if (conditions.length) tips.push(`Key requirements: ${conditions.slice(0, 3).join('; ')}.`);

  return {
    title: `Pre-departure briefing — ${journey.dest_name || journey.destination_code}`,
    generated_for: journey.departure_date || 'unscheduled trip',
    warnings,
    tips,
    conditions,
    source_authority: rule?.ver?.source_authority || null,
    confidence: rule?.ver?.confidence || 'needs_verification',
  };
}

// ── AI chat integration ───────────────────────────────────────────────────────
function plannerContext(user) {
  const journeys = Q.getJourneys(user.id) || [];
  if (!journeys.length) return '';
  const lines = journeys.slice(0, 3).map(j => {
    const tasks = Q.getJourneyTasks(j.id) || [];
    const r = computeReadiness(j, tasks);
    return `- Trip to ${j.dest_name || j.destination_code} (${j.purpose}, ${j.departure_date || 'no date yet'}): readiness ${r.score}%, ${r.done}/${r.total} tasks done${r.overdue ? `, ${r.overdue} OVERDUE` : ''}, visa status: ${j.visa_status || 'unknown'}`;
  });
  return `\n\n[TRAVELER'S ACTIVE JOURNEYS — reference these naturally when relevant, and always respect their chosen dates]\n${lines.join('\n')}`;
}

module.exports = { PURPOSE_TEMPLATES, UNIVERSAL_TASKS, buildChecklist, computeReadiness, preDepartureBriefing, plannerContext, parseFeeUsd, parseProcessingDays, addDays };
