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
const brain = require('../utils/brain');
const { buildAffiliateLinks } = require('./travel');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Private file storage (documents are user-owned, never public-static) ────
function uploadDir() {
  const dir = Q.getSetting('upload_dir') || './data/uploads';
  const resolved = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}
const DOC_MIME = {
  '.pdf':'application/pdf', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.doc':'application/msword',
  '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const MAX_UPLOAD = 10 * 1024 * 1024; // 10 MB

function journeyRule(user, journey) {
  try { return Q.getVisaRule(user.passport_code, journey.destination_code, journey.purpose)?.ver || null; }
  catch { return null; }
}

// Small direct-write helpers (route-local)
function execWalletFile(docId, userId, fields) {
  const { exec } = require('../db');
  exec('UPDATE passport_wallet SET file_name=?,file_path=?,file_size=?,file_mime=?,updated_at=datetime(\'now\') WHERE id=? AND user_id=?',
    [fields.file_name ?? '', fields.file_path ?? '', fields.file_size ?? 0, fields.file_mime ?? '', docId, userId]);
}
function execCase(journeyId, userId, kind, payload) {
  const { exec } = require('../db');
  exec('INSERT INTO journey_cases(journey_id,user_id,kind,payload_json) VALUES(?,?,?,?)',
    [journeyId, userId, kind, JSON.stringify(payload || {})]);
}

// Scan for new cases on demand (scheduler also scans periodically)
function scanCasesNow(journey, readiness) {
  const brain = require('../utils/brain');
  try { return brain.scanJourneyCases(journey, readiness); } catch { return []; }
}

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

/** Full brain forecast bundle for a journey (risk, readiness pace, fees, insights). */
function brainBundle(user, journey, tasks, daysToDeparture) {
  const rule = journeyRule(user, journey);
  const jCtx = { ...journey, days_to_departure: daysToDeparture };
  const risk = brain.assessRisk(jCtx, rule);
  const pace = brain.forecastReadiness(jCtx, tasks);
  const fees = brain.feeExposure(jCtx);
  const insights = brain.insightsFor(jCtx).map(i => ({ key: i.dedup_key, ...i.payload }));
  return { risk, pace, fees, insights };
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

// ── Passport wallet ───────────────────────────────────────────────────────────
// NOTE: literal routes (wallet/score/cases) are declared BEFORE '/:id' so
// Express matches them first — those segments are never journey ids.
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
  const doc = Q.getWalletDoc(parseInt(req.params.id), req.user.id);
  if (doc?.file_path) { try { fs.unlinkSync(doc.file_path); } catch {} }
  Q.deleteWalletDoc(parseInt(req.params.id), req.user.id);
  res.json({ message: 'Document removed' });
});

// Upload a file into a wallet document (private, owner-only access)
router.post('/wallet/docs/:id/file', requireAuth, (req, res) => {
  const doc = Q.getWalletDoc(parseInt(req.params.id), req.user.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const chunks = [];
  let size = 0;
  req.on('data', c => { size += c.length; if (size > MAX_UPLOAD) { req.destroy(); res.status(413).json({ error: 'File too large (max 10 MB)' }); } else chunks.push(c); });
  req.on('end', () => {
    try {
      const buf = Buffer.concat(chunks);
      if (!buf.length) return res.status(400).json({ error: 'Empty upload' });
      const ext = path.extname(doc.file_name || '').toLowerCase();
      const safeName = String(req.headers['x-file-name'] || doc.file_name || 'document.pdf').replace(/[^\w.\- ]/g, '_').slice(0, 120);
      const useExt = path.extname(safeName).toLowerCase() || ext || '.pdf';
      if (!DOC_MIME[useExt]) return res.status(400).json({ error: 'Allowed types: PDF, PNG, JPG, WEBP, DOC, DOCX' });
      const fname = `${req.user.id}_${doc.id}_${crypto.randomBytes(6).toString('hex')}${useExt}`;
      const fpath = path.join(uploadDir(), fname);
      fs.writeFileSync(fpath, buf);
      execWalletFile(doc.id, req.user.id, { file_name: safeName, file_path: fpath, file_size: buf.length, file_mime: DOC_MIME[useExt] });
      res.json({ message: 'File attached', file: { name: safeName, size: buf.length, mime: DOC_MIME[useExt] } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

// Download the attached file (owner only — never a public URL)
router.get('/wallet/docs/:id/file', requireAuth, (req, res) => {
  const doc = Q.getWalletDoc(parseInt(req.params.id), req.user.id);
  if (!doc?.file_path) return res.status(404).json({ error: 'No file attached' });
  if (!fs.existsSync(doc.file_path)) return res.status(410).json({ error: 'File missing from storage' });
  res.setHeader('Content-Type', doc.file_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${doc.file_name || 'document'}"`);
  fs.createReadStream(doc.file_path).pipe(res);
});

router.delete('/wallet/docs/:id/file', requireAuth, (req, res) => {
  const doc = Q.getWalletDoc(parseInt(req.params.id), req.user.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.file_path) { try { fs.unlinkSync(doc.file_path); } catch {} }
  execWalletFile(doc.id, req.user.id, { file_name: '', file_path: '', file_size: 0, file_mime: '' });
  res.json({ message: 'File removed' });
});

// ── Traveler score (profile) ──────────────────────────────────────────────
router.get('/score', requireAuth, (req, res) => {
  const passportCode = req.user.passport_code || 'NG';
  const journeys = Q.getJourneys(req.user.id) || [];
  const docs = Q.getWalletDocs(req.user.id) || [];
  const completed = journeys.filter(j => j.status === 'completed').length;
  const active = journeys.filter(j => !['completed'].includes(j.status)).length;
  const tasksAll = journeys.flatMap(j => Q.getJourneyTasks(j.id) || []);
  const tasksDone = tasksAll.filter(t => t.status === 'done').length;
  const passport = docs.find(d => d.doc_type === 'passport');
  const passportMonths = passport?.expiry_date
    ? Math.round((new Date(passport.expiry_date) - new Date()) / (1000 * 60 * 60 * 24 * 30.4)) : null;

  // Composite 0–100 traveler score: execution discipline dominates
  const completionAvg = journeys.length ? journeys.reduce((a, j) => {
    const ts = Q.getJourneyTasks(j.id) || [];
    return a + (ts.length ? ts.filter(t => t.status === 'done').length / ts.length : 0);
  }, 0) / journeys.length : 0;
  const score = Math.max(0, Math.min(100, Math.round(
    completionAvg * 60 +                    // checklist discipline
    Math.min(completed, 5) * 6 +            // completed trips (max 30)
    (passport ? (passportMonths != null && passportMonths >= 6 ? 10 : 0) : 0) + // passport ready
    (docs.length >= 2 ? 0 : 0)              // reserved for future signals
  )));
  const tier = score >= 85 ? 'Seasoned Traveller' : score >= 60 ? 'Confident Planner' : score >= 30 ? 'Rising Explorer' : 'First-Timer';  res.json({ score, tier, passport_code: passportCode,
    components: {
      checklist_discipline_pct: Math.round(completionAvg * 100),
      completed_trips: completed,
      active_journeys: active,
      tasks_done_total: tasksDone,
      tasks_total: tasksAll.length,
      passport_ready: !!(passport && passportMonths != null && passportMonths >= 6),
      passport_months_left: passportMonths,
      wallet_documents: docs.length,
    },
    breakdown: [
      { label: 'Checklist discipline', weight: '60%', value: Math.round(completionAvg * 100) },
      { label: 'Completed trips', weight: '30%', value: Math.min(completed, 5) * 6 + '/30' },
      { label: 'Passport readiness', weight: '10%', value: passport ? (passportMonths >= 6 ? '10/10' : '0/10') : '0/10' },
    ],
  });
});

// ── Brain Base: open cases + report / resolve ─────────────────────────────
router.get('/cases', requireAuth, (req, res) => {
  res.json({ cases: Q.getOpenCases(req.user.id) || [] });
});

// Reminder email preference (profile)
router.get('/reminders/pref', requireAuth, (req, res) => {
  res.json({ email_opt_out: !!req.user.email_opt_out, digest_opt_out: !!req.user.digest_opt_out, admin_enabled: Q.getSetting('notif_email_reminders') !== '0', digest_enabled: Q.getSetting('notif_email_digest') === '1' });
});

router.post('/reminders/pref', requireAuth, (req, res) => {
  const { email_opt_out, digest_opt_out } = req.body || {};
  if (email_opt_out !== undefined) Q.setEmailOptOut(req.user.id, !!email_opt_out);
  if (digest_opt_out !== undefined) Q.setDigestOptOut(req.user.id, !!digest_opt_out);
  res.json({ message: 'Preference saved', email_opt_out: email_opt_out !== undefined ? !!email_opt_out : !!req.user.email_opt_out, digest_opt_out: digest_opt_out !== undefined ? !!digest_opt_out : !!req.user.digest_opt_out });
});

router.post('/cases/:id/report', requireAuth, (req, res) => {
  const c = Q.getCase(parseInt(req.params.id), req.user.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  const { title, description, expected, actual } = req.body || {};
  if (!description) return res.status(400).json({ error: 'description required' });
  // Keep the case open but store the traveller's report for the brain + admin
  Q.resolveCase(c.id, req.user.id, `REPORTED: ${String(title || c.kind)} — ${description}`, { reported: true, expected, actual, reported_at: new Date().toISOString() });
  // Re-open as a user-reported case with the report payload preserved
  const j = Q.getJourney(c.journey_id, req.user.id);
  const insight = c.insight_key ? Q.getBrainInsight(c.insight_key) : null;
  const payload = { reported: true, title: title || c.kind, description, expected, actual, insight: insight ? JSON.parse(insight.payload_json) : null };
  execCase(c.journey_id, req.user.id, 'user_report', payload);
  res.json({ message: 'Report filed — the brain will use it to improve forecasts for everyone.', case: { kind: 'user_report' } });
});

router.post('/cases/:id/resolve', requireAuth, (req, res) => {
  const c = Q.getCase(parseInt(req.params.id), req.user.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  const { notes, action } = req.body || {};
  Q.resolveCase(c.id, req.user.id, notes || 'Resolved by traveller', { ...action, resolved_via: 'dashboard' });
  // Feed the brain: what action fixed this kind of case
  brain.seedInsights();
  Q.saveBrainInsight(`casefix::${c.kind}`, { kind: c.kind, insight_key: c.insight_key, notes: notes || '', action: action || {}, at: new Date().toISOString() }, 'traveller');
  res.json({ message: 'Case resolved — the brain learned from it.' });
});

router.post('/cases/:id/dismiss', requireAuth, (req, res) => {
  const c = Q.getCase(parseInt(req.params.id), req.user.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  Q.dismissCase(c.id, req.user.id, String(req.body?.notes || 'Dismissed by traveller'));
  res.json({ message: 'Case dismissed' });
});

router.get('/:id', requireAuth, (req, res) => {
  const j = Q.getJourney(parseInt(req.params.id), req.user.id);
  if (!j) return res.status(404).json({ error: 'Journey not found' });
  const tasks = Q.getJourneyTasks(j.id);
  const docs = Q.getWalletDocs(req.user.id);
  const days = j.departure_date ? Math.ceil((new Date(j.departure_date) - new Date()) / 86400000) : null;
  const { readiness, phases } = summarize(tasks, { ...j, days_to_departure: days }, docs);
  // Open any new cases the brain detects (appointment scarcity, overdue, passport)
  const casesNow = scanCasesNow({ ...j, days_to_departure: days }, readiness);
  const openCases = (Q.getOpenCases(req.user.id) || []).filter(c => c.journey_id === j.id);
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
    cases: openCases.map(c => ({ id: c.id, kind: c.kind, insight_key: c.insight_key, payload: (() => { try { return JSON.parse(c.payload_json || '{}'); } catch { return {}; } })() })),
    brain: brainBundle(req.user, j, tasks, days),
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

// ── Dossier: export / download the complete trip package ──────────────────
function buildDossier(j, tasks, docs, brainData, briefing, visa) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    generated_at: new Date().toISOString(),
    app: 'Japa+ — Travel smart. Land ready.',
    trip: {
      destination: j.dest_name || j.destination_code, code: j.destination_code,
      purpose: j.purpose, departure: j.departure_date, return: j.return_date,
      travellers: j.travellers, budget_usd: j.budget_usd || null, status: j.status,
    },
    visa_rule: {
      status: visa?.status || j.visa_status, fee: visa?.fees?.amount || j.visa_fee,
      processing: visa?.processing_days || j.processing_days, max_stay: visa?.max_stay || null,
      source_authority: visa?.source_authority || null, source_tier: visa?.source_tier ?? null,
      confidence: visa?.confidence || j.confidence, official_url: visa?.official_url || j.embassy_url || null,
      conditions: visa?.conditions || [],
      disclaimer: 'Verify on the official government site before paying anything. Japa+ cites sources and flags confidence, but rules change.',
    },
    forecast: brainData ? { delay_risk: brainData.risk, readiness_forecast: brainData.pace, fee_exposure: brainData.fees } : null,
    briefing,
    checklist: tasks.map(t => ({ phase: t.phase, task: t.title, deadline: t.deadline, done: t.status === 'done', detail: t.detail })),
    documents: docs.map(d => ({ type: d.doc_type, number_masked: d.doc_number ? d.doc_number.slice(0, 3) + '***' : '', expiry: d.expiry_date, attached_file: d.file_name || null })),
    footer: `Generated ${today} by Japa+ Journey OS. Keep a printed copy with your travel documents.`,
  };
}

router.get('/:id/dossier', requireAuth, (req, res) => {
  const j = Q.getJourney(parseInt(req.params.id), req.user.id);
  if (!j) return res.status(404).json({ error: 'Journey not found' });
  const tasks = Q.getJourneyTasks(j.id);
  const docs = Q.getWalletDocs(req.user.id);
  const days = j.departure_date ? Math.ceil((new Date(j.departure_date) - new Date()) / 86400000) : null;
  const user = Q.getUserById(req.user.id);
  const bData = brainBundle(user, j, tasks, days);
  const ver = journeyRule(user, j);
  const visa = ver ? {
    status: ver.status, max_stay: ver.max_stay, fees: (() => { try { return JSON.parse(ver.fees_json || '{}'); } catch { return {}; } })(),
    processing_days: ver.processing_days, source_authority: ver.source_authority, source_tier: ver.source_tier,
    confidence: ver.confidence, official_url: ver.official_url,
    conditions: (() => { try { return JSON.parse(ver.conditions_json || '[]'); } catch { return []; } })(),
  } : null;
  const briefing = J.preDepartureBriefing({ ...j, days_to_departure: days, user_id: req.user.id }, docs);
  const dossier = buildDossier(j, tasks, docs, bData, briefing, visa);
  Q.saveJourneyDossier(j.id, req.user.id, JSON.stringify(dossier));
  if (req.query.format === 'json') return res.json({ dossier });
  // Human-readable text download
  const L = [];
  const add = (s = '') => L.push(s);
  add('════════════════════════════════════════════════');
  add('  JAPA+ TRAVEL DOSSIER');
  add('════════════════════════════════════════════════');
  add(`Destination : ${dossier.trip.destination} (${dossier.trip.code})`);
  add(`Purpose     : ${dossier.trip.purpose}`);
  add(`Dates       : ${dossier.trip.departure || '—'} → ${dossier.trip.return || '—'}`);
  add(`Travellers  : ${dossier.trip.travellers}`);
  add(`Visa status : ${dossier.visa_rule.status} · fee ${dossier.visa_rule.fee || '—'} · processing ${dossier.visa_rule.processing || '—'}`);
  add(`Source      : ${dossier.visa_rule.source_authority || '—'} (tier ${dossier.visa_rule.source_tier ?? '—'}, ${dossier.visa_rule.confidence})`);
  if (dossier.visa_rule.official_url) add(`Apply at    : ${dossier.visa_rule.official_url}`);
  add();
  if (dossier.forecast?.delay_risk) {
    add(`── FORECAST ──`);
    add(`Delay risk  : ${dossier.forecast.delay_risk.delay_risk_pct == null ? '—' : dossier.forecast.delay_risk.delay_risk_pct + '% (' + dossier.forecast.delay_risk.risk_level + ')'}`);
    add(`Decision by : ${dossier.forecast.delay_risk.decision_by || '—'}`);
    add(`Readiness   : ${dossier.forecast.readiness_forecast.forecast_score == null ? '—' : dossier.forecast.readiness_forecast.forecast_score + '%'}`);
    add(`At stake    : $${dossier.forecast.fee_exposure.at_stake_usd} (${dossier.forecast.fee_exposure.note})`);
    add();
  }
  if (dossier.briefing.warnings.length) { add('── WARNINGS ──'); dossier.briefing.warnings.forEach(w => add('⚠ ' + w)); add(); }
  add('── CHECKLIST ──');
  for (const t of dossier.checklist) add(`[${t.done ? 'x' : ' '}] ${t.deadline || '—  '} ${t.phase}: ${t.task}`);
  add();
  add('── DOCUMENTS IN WALLET ──');
  dossier.documents.forEach(d => add(`- ${d.type} ${d.number_masked} exp ${d.expiry || '—'}${d.attached_file ? ' (file attached in app)' : ''}`));
  add();
  add(dossier.footer);
  const txt = L.join('\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="japa-dossier-${j.destination_code}-${(j.departure_date || 'plan')}.txt"`);
  res.send(txt);
});

module.exports = router;
