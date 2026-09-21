'use strict';
/**
 * Journey reminder scheduler — the "nanny" that keeps trips on track.
 *
 * Every scan it creates in-app notifications for:
 *   • tasks due within 3 days (one reminder per task, ever)
 *   • tasks already overdue (weekly nag, key = ISO week so it repeats)
 *   • T-30/T-14/T-7/T-1 departure countdowns
 *   • wallet documents expiring within 180 days or already expired (daily key)
 *
 * It also runs the Brain Base case scanner so open cases (appointment
 * scarcity, overdue tasks, passport validity) are opened automatically.
 *
 * Dedup strategy: each notification type has a stable dedup key stored in
 * brain_insights (e.g. rem:task:123, rem:overdue:123:2026-W38, rem:dep:5:14).
 * saveBrainInsight is INSERT OR IGNORE, so a notification is only created
 * when the key is new. Seeds are marked source='reminder' for easy audit.
 */
const { initDB, Q, persist } = require('../db');
const { seedInsights, scanJourneyCases } = require('../utils/brain');
const { computeReadiness } = require('../utils/journey');

const SCAN_INTERVAL = parseInt(process.env.JOURNEY_SCAN_INTERVAL || '300') * 1000;
let timer = null;

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return date.getUTCFullYear() + '-W' + Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function toIso(d) { return d.toISOString().slice(0, 10); }

/** Notify once per dedup key. Returns true when a notification was created. */
function notifyOnce(dedupKey, userId, title, message, type = 'info') {
  if (Q.getBrainInsight(dedupKey)) return false;
  Q.saveBrainInsight(dedupKey, { notified_at: new Date().toISOString() }, 'reminder');
  Q.createNotification(userId, title, message, type);
  return true;
}

async function runOnce() {
  try {
    await initDB();
    seedInsights();
    const today = toIso(new Date());

    // Active journeys of all users (skip cancelled)
    const journeys = (() => {
      try {
        return Q.queryAllSafe(`SELECT j.*, d.name as dest_name, d.flag as dest_flag FROM journeys j LEFT JOIN destinations d ON d.code=j.destination_code WHERE j.status != 'cancelled'`);
      } catch { return []; }
    })();

    let notifications = 0, casesOpened = 0;

    for (const j of journeys) {
      // ── Task reminders ──────────────────────────────────────────────────
      const tasks = Q.getJourneyTasks(j.id) || [];
      for (const t of tasks) {
        if (t.status === 'done' || !t.deadline) continue;
        const days = Math.ceil((new Date(t.deadline) - new Date(today)) / 86400000);
        if (days === 0 || days === 1 || days === 2 || days === 3) {
          if (notifyOnce(`rem:task:${t.id}`, j.user_id,
            `⏰ ${j.dest_flag || ''} ${j.dest_name || j.destination_code}: task due ${days === 0 ? 'today' : 'in ' + days + ' day(s)'}`,
            `${t.title}\n${t.detail || ''}\n\nOpen My Journey to tick it off.`)) notifications++;
        } else if (days < 0) {
          // overdue: weekly nag with ISO-week key
          if (notifyOnce(`rem:overdue:${t.id}:${isoWeek(new Date())}`, j.user_id,
            `⚠️ Overdue: ${j.dest_name || j.destination_code} — ${t.title}`,
            `This task was due ${t.deadline} and is still open. ${t.detail || ''}`)) notifications++;
        }
      }

      // ── Departure countdowns (T-30/14/7/1) ──────────────────────────────
      if (j.departure_date) {
        const depDays = Math.ceil((new Date(j.departure_date) - new Date(today)) / 86400000);
        if ([30, 14, 7, 1].includes(depDays)) {
          if (notifyOnce(`rem:dep:${j.id}:${depDays}`, j.user_id,
            `🛫 ${j.dep_flag || j.dest_flag || ''} ${j.dest_name || j.destination_code} — ${depDays} day(s) to departure`,
            depDays === 1 ? 'Final checks: online check-in, printed documents, money split. Safe travels!'
              : `Check your Journey readiness and clear any overdue tasks this week.`)) notifications++;
        }
      }

      // ── Brain Base case scan ────────────────────────────────────────────
      const tasksAll = Q.getJourneyTasks(j.id) || [];
      const docs = Q.getWalletDocs(j.user_id) || [];
      const readiness = computeReadiness(j, tasksAll, docs);
      const jCtx = { ...j, days_to_departure: j.departure_date ? Math.ceil((new Date(j.departure_date) - new Date(today)) / 86400000) : null };
      try {
        const detected = scanJourneyCases(jCtx, readiness);
        casesOpened += detected.length;
      } catch {}
    }

    // ── Wallet document expiry reminders ──────────────────────────────────
    try {
      const docs = Q.queryAllSafe(`SELECT w.*, u.id as uid FROM passport_wallet w JOIN users u ON u.id=w.user_id WHERE w.expiry_date IS NOT NULL AND w.expiry_date != ''`);
      for (const d of docs) {
        const days = Math.ceil((new Date(d.expiry_date) - new Date(today)) / 86400000);
        if (days <= 180) {
          const expired = days < 0;
          if (notifyOnce(`rem:doc:${d.id}:${expired ? 'expired' : toIso(new Date()).slice(0, 7)}`, d.uid,
            expired ? `🚨 Your ${d.doc_type} expired` : `🛂 ${d.doc_type} expiring soon`,
            expired
              ? `Expired on ${d.expiry_date}. Renew it before any new trip — a valid passport is the first requirement.`
              : `Expires ${d.expiry_date} (${days} days). Under the 6-month rule many countries will deny boarding before then.`)) notifications++;
        }
      }
    } catch {}

    if (notifications || casesOpened) {
      persist();
      console.log(`[journey-reminders] ${notifications} reminder(s), ${casesOpened} case(s) opened`);
    }
  } catch (e) {
    console.error('[journey-reminders] scan failed:', e.message);
  }
}

function startJourneyScheduler() {
  if (timer) return;
  runOnce();
  timer = setInterval(runOnce, SCAN_INTERVAL);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`⏰ Journey reminder scheduler running (scans every ${SCAN_INTERVAL / 1000}s)`);
}

module.exports = { startJourneyScheduler, runOnce };
