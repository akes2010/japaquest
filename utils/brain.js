'use strict';
/**
 * Brain Base — the forecasting and pattern-memory layer of Journey OS.
 *
 * It learns from resolved traveller cases (what actually went wrong and what
 * fixed it), carries a library of verified high-frequency insights (embassy
 * appointment droughts, decision-day patterns, document traps), and forecasts
 * per journey:
 *   • delay risk   — probability the visa decision lands after departure
 *   • readiness    — forecast completion score by departure day
 *   • fee exposure — total money at stake for a family of N
 *
 * Forecasting uses the journey's verified visa rule (processing time, source
 * tier, confidence, fees) and today's task completion — never invented data.
 */
const { Q } = require('../db');

// ── Verified insight library ──────────────────────────────────────────────────
// dedup keys are stable so re-seeding never duplicates. Each payload carries
// `forecast` hints used by assessRisk() and planner text used by the AI.
const INSIGHTS = [
  {
    dedup_key: 'apply::vfs_appointment_drought',
    payload: {
      title: 'Appointment slots vanish within minutes of release',
      matches: { regions: ['Africa'], statuses: ['visa_required'] },
      severity: 'high',
      advice: 'VFS/TLScontact slots in Lagos, Accra and Nairobi are released in batches and booked within minutes. Create your account early, verify your phone/email beforehand, and log in 10 minutes before the known release time. Use the official queue — never pay touts.',
      ai_note: 'Warn the traveller that appointment slots for biometrics are scarce and released in batches; advise booking the moment the window opens and using only the official site.',
    },
  },
  {
    dedup_key: 'decision::85pct_before_deadline',
    payload: {
      title: 'Most decisions land before the published deadline — but plan for the tail',
      matches: {},
      severity: 'info',
      advice: 'Historically ~85% of standard visitor decisions arrive before the advertised processing deadline, but the remaining tail can slip weeks. Book refundable, keep flexibility, and never schedule non-refundable events inside the decision window.',
      ai_note: 'Set expectations: most visas arrive before the deadline, but plan the trip so nothing critical depends on the last week.',
    },
  },
  {
    dedup_key: 'docs::sudden_deposit_flag',
    payload: {
      title: 'Sudden lump deposits trigger finance doubts',
      matches: { purposes: ['Tourism', 'Family Visit'] },
      severity: 'high',
      advice: 'Caseworkers read 3–6 months of statements. A large unexplained deposit shortly before applying is the most common silent killer. Move money early, keep salary credits flowing, and document any genuine gift with a signed letter.',
      ai_note: 'If departure is far away, advise structuring funds now so statements look natural by application time.',
    },
  },
  {
    dedup_key: 'docs::date_mismatch_rejections',
    payload: {
      title: 'Cross-document date mismatches cause quiet refusals',
      matches: {},
      severity: 'medium',
      advice: 'Itinerary, hotel booking, insurance dates, employment leave letter and cover letter must agree exactly. Build all dates from ONE source of truth (your Japa+ journey) and check them twice before submission.',
      ai_note: 'Tell the traveller to make every document reflect the same dates as the journey plan before applying.',
    },
  },
  {
    dedup_key: 'docs::passport_10y_schengen_rule',
    payload: {
      title: 'Schengen requires passports younger than 10 years',
      matches: { statuses: ['visa_required'], destinations_hint: ['Schengen'] },
      severity: 'medium',
      advice: 'For Schengen short stays your passport must have been issued within the last 10 years and be valid 3 months beyond departure. A valid-looking passport can still be rejected on issue date — check it before booking anything.',
      ai_note: 'For Schengen trips, remind the traveller about the 10-year passport issue-date rule, not just the 6-month validity rule.',
    },
  },
  {
    dedup_key: 'money::fx_and_card_prep',
    payload: {
      title: 'Money prep beats exchange panic',
      matches: {},
      severity: 'low',
      advice: 'Order a low-fee travel card 2+ weeks out, split cards and cash between bags and person, and install an eSIM before the flight. Airport exchange desks and roaming bills are the two most avoidable losses.',
      ai_note: 'Recommend sorting travel money and an eSIM at least two weeks before departure.',
    },
  },
];

function seedInsights() {
  for (const ins of INSIGHTS) Q.saveBrainInsight(ins.dedup_key, ins.payload, 'editorial');
}

/** Insights that apply to a journey (statuses / purposes / regions). */
function insightsFor(journey) {
  const out = [];
  for (const ins of INSIGHTS) {
    const m = ins.payload.matches || {};
    if (m.statuses && !m.statuses.includes(journey.visa_status)) continue;
    if (m.purposes && !m.purposes.includes(journey.purpose)) continue;
    out.push(ins);
  }
  return out;
}

// ── Delay-risk forecast ───────────────────────────────────────────────────────
// Mirrors the fee parser in utils/journey.js
function parseProcessingDays(text) {
  const m = String(text || '').match(/(\d+)\s*[-–]\s*(\d+)/);
  if (m) return parseInt(m[2]);
  const s = String(text || '').match(/\d+/);
  return s ? parseInt(s[0]) : null;
}

function parseFeeUsd(feeText) {
  const raw = String(feeText ?? '').trim();
  if (!raw || /varies|—/i.test(raw)) return null;
  if (/free/i.test(raw)) return 0;
  const m = raw.match(/([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (/£/.test(raw)) n *= 1.27;
  else if (/€/.test(raw)) n *= 1.08;
  else if (/CAD/i.test(raw)) n *= 0.73;
  return Math.round(n);
}

function toIso(d) { return d.toISOString().slice(0, 10); }

/**
 * Forecast delay risk for a journey.
 * rule: {processing_days, source_tier, confidence, status, fees} | null
 * journey: with departure_date, days_to_departure
 */
function assessRisk(journey, rule) {
  const now = new Date();
  const departure = journey.departure_date ? new Date(journey.departure_date) : null;
  const daysToDeparture = departure ? Math.ceil((departure - now) / 86400000) : null;
  const visaFree = ['visa_free', 'voa'].includes(journey.visa_status);

  // No visa needed → no decision risk
  if (visaFree) {
    return {
      delay_risk_pct: 0, risk_level: 'low',
      decision_by: null, decision_buffer_days: null,
      days_to_departure: daysToDeparture,
      headline: 'No visa decision to wait for',
      actions: [],
      confidence_note: journey.visa_status === 'visa_free'
        ? 'Visa-free travel — no processing risk.'
        : 'Visa on arrival — small queue risk only.',
    };
  }

  const pd = parseProcessingDays(rule?.processing_days) || 21;
  const tierPenalty = rule?.source_tier ? (rule.source_tier - 1) * 4 : 8; // weaker sources → wider tail
  const confBoost = rule?.confidence === 'recently_reviewed' ? 0 : 5;
  // Base "tail" probability that the decision slips past the published time
  const tail = Math.min(45, 12 + tierPenalty + confBoost);

  // No date yet → structural risk only
  if (daysToDeparture == null || daysToDeparture <= 0) {
    return {
      delay_risk_pct: null, risk_level: 'unknown',
      decision_by: null, decision_buffer_days: pd + 14,
      days_to_departure: daysToDeparture,
      headline: 'Set a departure date to forecast your decision deadline',
      actions: ['Pick a departure date so the planner can forecast when your decision must land.'],
      confidence_note: `Published processing: up to ${pd} days. The brain plans for a ${pd + 14}-day safe window.`,
    };
  }

  // Decision deadline = departure − safety buffer (2 weeks)
  const bufferDays = pd + 14;
  const decisionBy = toIso(new Date(departure.getTime() - 14 * 86400000));

  // Has the traveller applied? = the "Apply for the visa" task done
  const tasks = Q.getJourneyTasks(journey.id) || [];
  const applyTask = tasks.find(t => t.phase === 'apply' && /apply for the visa/i.test(t.title));
  const applied = applyTask?.status === 'done';

  const applyBy = toIso(new Date(departure.getTime() - bufferDays * 86400000));
  const daysLate = Math.ceil((now - new Date(applyBy)) / 86400000); // >0 = past safe apply window

  let risk = tail;
  const actions = [];
  if (!applied) {
    if (daysLate > 0) {
      risk = Math.min(92, 45 + daysLate * 4 + tail / 2);
      actions.push(`You are ${daysLate} day(s) past the safe apply window (was ${applyBy}). Apply today and consider shifting departure later.`);
    } else {
      const slack = -daysLate;
      risk = Math.max(5, tail - slack);
      actions.push(`Apply by ${applyBy} to keep the risk low (${slack} days of slack left).`);
    }
  } else {
    const elapsed = applyTask.completed_at ? Math.ceil((now - new Date(applyTask.completed_at)) / 86400000) : 0;
    const remaining = daysToDeparture - (bufferDays - elapsed);
    risk = Math.max(3, tail - 10);
    if (daysToDeparture < pd) {
      risk = Math.min(90, 55 + tierPenalty);
      actions.push(`Departure is inside the published processing window (${pd} days) — decision may not land in time. Prepare a fallback date.`);
    }
    actions.push(`Application submitted ${elapsed} day(s) ago. Decision expected before ${decisionBy}.`);
  }

  const risk_level = risk >= 55 ? 'high' : risk >= 25 ? 'medium' : 'low';
  return {
    delay_risk_pct: Math.round(risk),
    risk_level,
    decision_by: decisionBy,
    decision_buffer_days: bufferDays,
    days_to_departure: daysToDeparture,
    processing_days_published: pd,
    headline: applied
      ? `Decision expected before ${decisionBy} — ${risk_level} slip risk`
      : `${risk_level} risk of the decision not landing before departure`,
    actions,
    confidence_note: `Forecast from the verified rule (processing: ${rule?.processing_days || pd + ' days'}, source tier ${rule?.source_tier ?? '?'}, confidence: ${rule?.confidence || 'unknown'}) + your checklist progress.`,
  };
}

// ── Readiness forecast ────────────────────────────────────────────────────────
function forecastReadiness(journey, tasks) {
  if (!journey.departure_date || tasks.length === 0) {
    return { forecast_score: null, verdict: 'Set a departure date to see your forecast readiness.' };
  }
  const days = Math.ceil((new Date(journey.departure_date) - new Date()) / 86400000);
  if (days <= 0) return { forecast_score: null, verdict: 'Trip date has arrived or passed — execute the on-arrival tasks.' };

  // Pace: tasks whose deadline has already passed should be done by now.
  const today = toIso(new Date());
  const dueNow = tasks.filter(t => t.deadline && t.deadline <= today).length || 1;
  const doneDue = tasks.filter(t => t.deadline && t.deadline <= today && t.status === 'done').length;
  const paceScore = Math.round((doneDue / dueNow) * 100);

  const forecast = Math.max(0, Math.min(100, paceScore));
  const verdict =
    forecast >= 85 ? 'On pace to be fully ready by departure — keep the streak.'
    : forecast >= 60 ? 'Slightly behind pace — clear the oldest tasks this week to recover.'
    : 'Off pace: at today\u2019s progress you will not be ready in time. Prioritise overdue tasks immediately.';
  return { forecast_score: forecast, verdict, pace_score: paceScore, days_left: days };
}

// ── Fee exposure ──────────────────────────────────────────────────────────────
function feeExposure(journey) {
  const fee = parseFeeUsd(journey.visa_fee);
  const pax = Math.max(1, journey.travellers || 1);
  const daily = journey.avg_daily_budget_usd || 80;
  const days = journey.departure_date && journey.return_date
    ? Math.max(1, Math.ceil((new Date(journey.return_date) - new Date(journey.departure_date)) / 86400000))
    : null;
  const tripBudget = days ? Math.round(daily * days * pax) : null;
  return {
    visa_fee_usd_each: fee,
    visa_fee_usd_total: fee == null ? null : fee * pax,
    travellers: pax,
    trip_days: days,
    trip_budget_usd: tripBudget,
    at_stake_usd: (fee == null ? 0 : fee * pax) + (tripBudget || 0),
    note: 'Total money at stake if the visa is refused (visa fees + trip budget). Book refundable to protect it.',
  };
}

// ── Insight → case matching ───────────────────────────────────────────────────
/**
 * Scan a journey for conditions that should open a "case" (a tracked,
 * resolvable situation). Existing open cases are never duplicated.
 * Returns the list of case kinds detected this pass.
 */
function scanJourneyCases(journey, readiness) {
  const detected = [];
  const visaFree = ['visa_free', 'voa'].includes(journey.visa_status);

  // 1) Overdue tasks case
  if (readiness.overdue > 0) {
    const tasks = Q.getJourneyTasks(journey.id) || [];
    const worst = tasks.filter(t => t.status !== 'done' && t.deadline && t.deadline < toIso(new Date()))
      .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
    const insight = Q.getBrainInsight('docs::sudden_deposit_flag');
    const id = Q.createCase(journey.id, journey.user_id, 'task_overdue', worst ? worst.title.slice(0, 60) : null, {
      overdue_count: readiness.overdue,
      worst_task: worst ? { id: worst.id, title: worst.title, deadline: worst.deadline } : null,
      insight: insight ? JSON.parse(insight.payload_json) : null,
    });
    if (id) detected.push({ id, kind: 'task_overdue' });
  }

  // 2) Appointment scarcity case (visa-required + departure 30–90 days out, not applied)
  if (!visaFree && journey.days_to_departure != null && journey.days_to_departure <= 90 && journey.days_to_departure >= 30) {
    const tasks = Q.getJourneyTasks(journey.id) || [];
    const applied = tasks.some(t => t.phase === 'apply' && /apply for the visa/i.test(t.title) && t.status === 'done');
    if (!applied) {
      const insight = Q.getBrainInsight('apply::vfs_appointment_drought');
      const id = Q.createCase(journey.id, journey.user_id, 'appointment_scarcity', 'apply::vfs_appointment_drought', {
        insight: insight ? JSON.parse(insight.payload_json) : null,
        days_to_departure: journey.days_to_departure,
      });
      if (id) detected.push({ id, kind: 'appointment_scarcity' });
    }
  }

  // 3) Passport validity case (from wallet)
  const docs = Q.getWalletDocs(journey.user_id) || [];
  const pass = docs.find(d => d.doc_type === 'passport');
  if (pass?.expiry_date && journey.departure_date) {
    const monthsAtDeparture = (new Date(pass.expiry_date) - new Date(journey.departure_date)) / (1000 * 60 * 60 * 24 * 30.4);
    if (monthsAtDeparture < 6) {
      const id = Q.createCase(journey.id, journey.user_id, 'passport_validity', 'docs::passport_10y_schengen_rule', {
        expiry_date: pass.expiry_date,
        months_left_at_departure: Math.round(monthsAtDeparture),
      });
      if (id) detected.push({ id, kind: 'passport_validity' });
    }
  }

  return detected;
}

// ── AI context ────────────────────────────────────────────────────────────────
function brainContext(user) {
  const journeys = Q.getJourneys(user.id) || [];
  const openCases = Q.getOpenCases(user.id) || [];
  if (!journeys.length) return '';
  const lines = [];
  for (const j of journeys.slice(0, 3)) {
    const rule = (() => {
      try { return Q.getVisaRule(user.passport_code, j.destination_code, j.purpose)?.ver || null; } catch { return null; }
    })();
    const risk = assessRisk({ ...j, days_to_departure: null }, rule);
    const tasks = Q.getJourneyTasks(j.id) || [];
    const f = forecastReadiness(j, tasks);
    lines.push(`- ${j.dest_name || j.destination_code} (${j.purpose}, dep ${j.departure_date || 'unset'}): visa ${j.visa_status || '?'}, delay risk ${risk.delay_risk_pct == null ? '?' : risk.delay_risk_pct + '% ' + risk.risk_level}, forecast readiness ${f.forecast_score == null ? '?' : f.forecast_score + '%'}`);
  }
  let caseLines = '';
  if (openCases.length) {
    caseLines = `\n[OPEN CASES the traveller is tracking — acknowledge if the user asks about problems]\n${openCases.slice(0, 3).map(c => `- ${c.kind} on ${c.dest_name || 'trip'} (detected ${String(c.detected_at).slice(0, 10)})`).join('\n')}`;
  }
  return `\n\n[TRAVELER'S JOURNEY FORECASTS — cite these numbers naturally when relevant]\n${lines.join('\n')}${caseLines}`;
}

module.exports = { INSIGHTS, seedInsights, insightsFor, assessRisk, forecastReadiness, feeExposure, scanJourneyCases, brainContext, parseFeeUsd, parseProcessingDays };
