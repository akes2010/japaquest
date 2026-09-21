'use strict';
/**
 * Journey OS API — the smart trip execution system.
 *
 * POST /api/journey          — create journey from destination (+auto checklist)
 * GET  /api/journey          — list journeys with readiness
 * GET  /api/journey/:id      — full plan: tasks, timeline, briefing, links
 * PATCH /api/journey/:id     — update dates / status (regenerates deadlines)
 * DELETE /api/journey/:id    — remove
 * PATCH /api/journey/:id/task/:taskId — tick tasks
 * POST /api/journey/wizard   — the dream-trip wizard (natural-language-ish)
 * GET  /api/journey/:id/briefing — pre-departure briefing
 */
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { Q } = require('../db');
const J = require('../utils/journey');
const { buildAffiliateLinks } = require('./travel');

function summarize(taskList, journey, docs) {
  const readiness = J.computeReadiness(journey, taskList, docs);
  const phases = {};
  for (const t of taskList) {
    (phases[t.phase] = phases[t.phase] || { total: 0, done: 0 });
    phases[t.phase].total++;
    if (t.status === 'done') phases[t.phase].done++;
  }
  return { readiness, phases };
}

// ── Wizard: "help me achieve my dream trip" ──────────────────────────────────
router.post('/wizard', requireAuth, (req, res) => {
  const { text, destination, purpose, departure_date, return_date, travellers, budget_usd } = req.body || {};
  const user = Q.getUserById(req.user.id);

  // Destination: explicit code, else parse from free text against DB destinations
  let destCode = String(destination || '').toUpperCase().trim();
  if (!destCode && text) {
    const dests = Q.getDestinations() || [];
    const low = String(text).toLowerCase();
    const aliasMap = { 'uae': 'AE', 'dubai': 'AE', 'uk': 'GB', 'britain': 'GB', 'london': 'GB', 'usa': 'US', 'america': 'US' };
    for (const [alias, code] of Object.entries(aliasMap)) if (low.includes(alias)) { destCode = code; break; }
    if (!destCode) {
      const d = dests.find(d => low.includes(String(d.name).toLowerCase()));
      if (d) destCode = d.code;
    }
  }
  if (!destCode) return res.status(400).json({ error: 'Could not determine a destination. Name a country or city.' });

  const dest = Q.getDestination(destCode);
  if (!dest) return res.status(400).json({ error: `Unknown destination code ${destCode}` });

  // Purpose: explicit, else keyword detection
  let purp = purpose;
  if (!purp && text) {
    const low = String(text).toLowerCase();
    if (/study|universit|school|course|admission|scholarship/.test(low)) purp = 'Study';
    else if (/\bwork\b|\bjob\b|employment|relocate|migrate/.test(low)) purp = 'Work';
    else if (/business|conference|meeting|expo|trade fair/.test(low)) purp = 'Business';
    else if (/(visit|visiting|see)\s+(my|our|the)\s+\w*\s*(family|parents|sister|brother|cousin|grand)/.test(low) || /family (visit|reunion)/.test(low)) purp = 'Family Visit';
    else purp = 'Tourism';
  }
  purp = purp || 'Tourism';

  // Create journey (idempotent per user+dest+purpose)
  const rule = Q.getVisaRule(user.passport_code, destCode, purp);
  const ver = rule?.ver;
  const journey = Q.createJourney(req.user.id, {
    destination_code: destCode, purpose: purp,
    departure_date: departure_date || null, return_date: return_date || null,
    travellers, budget_usd,
    source_tier: ver?.source_tier ?? null,
    confidence: ver?.confidence ?? 'needs_verification',
    visa_status: ver?.status || 'needs_verification',
    visa_fee: (() => { try { return JSON.parse(ver?.fees_json || '{}').amount || null; } catch { return null; } })(),
    processing_days: ver?.processing_days || null,
    embassy_url: ver?.official_url || null,
  });
  if (!journey) return res.status(500).json({ error: 'Could not create journey' });

  // (Re)generate the checklist — keeps deadlines in sync with dates
  Q.setJourneyTasks(journey.id, J.buildChecklist(rule, journey));

  const tasks = Q.getJourneyTasks(journey.id);
  const docs = Q.getWalletDocs(req.user.id);
  const { readiness, phases } = summarize(tasks, journey, docs);

  res.json({
    journey: { ...journey, dest_name: dest.name, dest_flag: dest.flag },
    visa: ver ? {
      status: ver.status, max_stay: ver.max_stay, fees: JSON.parse(ver.fees_json || '{}'),
      processing_days: ver.processing_days, source_authority: ver.source_authority,
      source_tier: ver.source_tier, confidence: ver.confidence, official_url: ver.official_url,
      conditions: JSON.parse(ver.conditions_json || '[]'),
    } : { status: 'needs_verification', confidence: 'needs_verification' },
    tasks, readiness, phases,
    message: ver && ver.status === 'visa_free'
      ? `${dest.flag} ${dest.name} is visa-free for your passport — up to ${ver.max_stay || 'the allowed stay'}. Your checklist focuses on documents, money and bookings.`
      : `Plan created for ${dest.flag} ${dest.name} (${purp}). ${tasks.length} tasks with real deadlines from the verified visa rule.`,
  });
});

// ── CRUD ──────────────────────────────────────────────────────────────────────
router.post('/', requireAuth, (req, res) => {
  const { destination_code, purpose, departure_date, return_date, travellers, budget_usd } = req.body || {};
  if (!destination_code) return res.status(400).json({ error: 'destination_code required' });
  const dest = Q.getDestination(destination_code);
  if (!dest) return res.status(400).json({ error: 'Unknown destination' });

  const rule = Q.getVisaRule(Q.getUserById(req.user.id).passport_code, destination_code.toUpperCase(), purpose || 'Tourism');
  const ver = rule?.ver;
  const journey = Q.createJourney(req.user.id, {
    destination_code, purpose, departure_date, return_date, travellers, budget_usd,
    source_tier: ver?.source_tier ?? null, confidence: ver?.confidence ?? 'needs_verification',
    visa_status: ver?.status || 'needs_verification',
    visa_fee: (() => { try { return JSON.parse(ver?.fees_json || '{}').amount || null; } catch { return null; } })(),
    processing_days: ver?.processing_days || null, embassy_url: ver?.official_url || null,
  });
  if (!journey) return res.status(409).json({ error: 'A journey for this destination and purpose already exists' });
  Q.setJourneyTasks(journey.id, J.buildChecklist(rule, journey));
  res.json({ journey, tasks: Q.getJourneyTasks(journey.id) });
});

router.get('/', requireAuth, (req, res) => {
  const journeys = Q.getJourneys(req.user.id) || [];
  const docs = Q.getWalletDocs(req.user.id);
  const out = journeys.map(j => {
    const tasks = Q.getJourneyTasks(j.id);
    const { readiness, phases } = summarize(tasks, j, docs);
    return { ...j, readiness, phases, nextTask: tasks.find(t => t.status !== 'done') || null };
  });
  res.json({ journeys: out });
});

router.get('/:id', requireAuth, (req, res) => {
  const j = Q.getJourney(parseInt(req.params.id), req.user.id);
  if (!j) return res.status(404).json({ error: 'Journey not found' });
  const tasks = Q.getJourneyTasks(j.id);
  const docs = Q.getWalletDocs(req.user.id);
  const { readiness, phases } = summarize(tasks, { ...j, days_to_departure: null }, docs);
  const days = j.departure_date ? Math.ceil((new Date(j.departure_date) - new Date()) / 86400000) : null;
  const rule = Q.getVisaRule(Q.getUserById(req.user.id).passport_code, j.destination_code, j.purpose);
  const ver = rule?.ver;
  res.json({
    journey: { ...j, days_to_departure: days },
    visa: ver ? {
      status: ver.status, max_stay: ver.max_stay, fees: JSON.parse(ver.fees_json || '{}'),
      processing_days: ver.processing_days, source_authority: ver.source_authority,
      source_tier: ver.source_tier, confidence: ver.confidence, official_url: ver.official_url,
      conditions: JSON.parse(ver.conditions_json || '[]'),
    } : null,
    tasks, readiness, phases,
    briefing: J.preDepartureBriefing({ ...j, days_to_departure: days, avg_daily_budget_usd: j.avg_daily_budget_usd, user_id: req.user.id }, docs),
    links: buildAffiliateLinks({ destination: j.destination_code, destName: j.dest_name }),
  });
});

router.patch('/:id', requireAuth, (req, res) => {
  const j = Q.getJourney(parseInt(req.params.id), req.user.id);
  if (!j) return res.status(404).json({ error: 'Journey not found' });
  Q.updateJourney(j.id, req.user.id, req.body || {});
  // Date changes recompute every task deadline
  if (req.body?.departure_date !== undefined) {
    const updated = Q.getJourney(j.id, req.user.id);
    const rule = Q.getVisaRule(Q.getUserById(req.user.id).passport_code, updated.destination_code, updated.purpose);
    Q.setJourneyTasks(j.id, J.buildChecklist(rule, updated));
  }
  const tasks = Q.getJourneyTasks(j.id);
  const docs = Q.getWalletDocs(req.user.id);
  const { readiness, phases } = summarize(tasks, Q.getJourney(j.id, req.user.id), docs);
  res.json({ journey: Q.getJourney(j.id, req.user.id), tasks, readiness, phases });
});

router.delete('/:id', requireAuth, (req, res) => {
  Q.deleteJourney(parseInt(req.params.id), req.user.id);
  res.json({ message: 'Journey removed' });
});

router.patch('/:id/task/:taskId', requireAuth, (req, res) => {
  const j = Q.getJourney(parseInt(req.params.id), req.user.id);
  if (!j) return res.status(404).json({ error: 'Journey not found' });
  const task = Q.getJourneyTasks(j.id).find(t => t.id === parseInt(req.params.taskId));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  Q.updateJourneyTask(task.id, j.id, req.body?.status === 'done' ? 'done' : 'pending');
  const tasks = Q.getJourneyTasks(j.id);
  const docs = Q.getWalletDocs(req.user.id);
  const { readiness, phases } = summarize(tasks, j, docs);
  res.json({ task: tasks.find(t => t.id === task.id), readiness, phases });
});

// ── Pre-departure briefing ────────────────────────────────────────────────────
router.get('/:id/briefing', requireAuth, (req, res) => {
  const j = Q.getJourney(parseInt(req.params.id), req.user.id);
  if (!j) return res.status(404).json({ error: 'Journey not found' });
  const days = j.departure_date ? Math.ceil((new Date(j.departure_date) - new Date()) / 86400000) : null;
  const docs = Q.getWalletDocs(req.user.id);
  res.json({ briefing: J.preDepartureBriefing({ ...j, days_to_departure: days, user_id: req.user.id }, docs) });
});

// ── Passport wallet ───────────────────────────────────────────────────────────
router.get('/wallet/docs', requireAuth, (req, res) => {
  const docs = Q.getWalletDocs(req.user.id) || [];
  const today = new Date().toISOString().slice(0, 10);
  const enriched = docs.map(d => {
    let daysLeft = null;
    if (d.expiry_date) daysLeft = Math.ceil((new Date(d.expiry_date) - new Date()) / 86400000);
    let alert = null;
    if (daysLeft !== null && daysLeft < 0) alert = 'expired';
    else if (daysLeft !== null && daysLeft < 183) alert = 'expiring_soon'; // 6-month rule window
    return { ...d, days_left: daysLeft, alert };
  });
  res.json({ docs: enriched });
});

router.post('/wallet/docs', requireAuth, (req, res) => {
  const { doc_type, doc_number, holder_name, issue_date, expiry_date, issuing_country, notes } = req.body || {};
  if (!doc_type) return res.status(400).json({ error: 'doc_type required' });
  if (expiry_date && issue_date && new Date(expiry_date) <= new Date(issue_date))
    return res.status(400).json({ error: 'Expiry must be after issue date' });
  const id = Q.upsertWalletDoc(req.user.id, { doc_type, doc_number, holder_name, issue_date, expiry_date, issuing_country, notes });
  res.json({ message: 'Document saved', id });
});

router.delete('/wallet/docs/:id', requireAuth, (req, res) => {
  Q.deleteWalletDoc(parseInt(req.params.id), req.user.id);
  res.json({ message: 'Document removed' });
});

module.exports = router;
