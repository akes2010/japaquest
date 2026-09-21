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
const BRAND = require('../config/brand');

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

// ── Email delivery (best-effort, in-app notification is the primary channel) ─
async function emailReminder(user, subject, heading, lines) {
  const settings = Q.getSettingsByGroup('notifications') || {};
  if (String(settings.notif_email_reminders) === '0') return false;
  if (user.email_opt_out) return false;
  if (!user.email) return false;
  try {
    const { sendEmail } = require('../utils/mailer');
    const appName = Q.getSetting('app_name') || BRAND.NAME;
    const appUrl = (Q.getSetting('app_url') || '').replace(/\/$/, '');
    await sendEmail({
      to: user.email,
      subject: `${appName} · ${subject}`,
      html: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #eee;border-radius:14px;overflow:hidden">
  <div style="background:#0A1428;color:#F7F3EA;padding:18px 24px;font-size:15px;font-weight:600">${appName} · ${heading}</div>
  <div style="padding:20px 24px;color:#222;line-height:1.7">
    ${lines.map(l => `<p style="margin:0 0 10px">${l}</p>`).join('')}
    <p style="margin:16px 0 0"><a href="${appUrl}/dashboard" style="background:#0A1428;color:#F7F3EA;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:600;display:inline-block">Open my Journey →</a></p>
    <p style="margin:18px 0 0;font-size:12px;color:#999">You get this because journey reminders are on. Manage it in Profile → Preferences.</p>
  </div>
</div>`,
    });
    return true;
  } catch (e) {
    if (!emailReminder._warned) { console.warn('[journey-reminders] email skipped:', e.message); emailReminder._warned = true; }
    return false;
  }
}

// ── Weekly digest (Mondays) ───────────────────────────────────────────────────
/** Compose the digest HTML for one user from live readiness + cases. */
function digestHtmlFor(user, appName, appUrl) {
  const today = toIso(new Date());
  const journeys = Q.getJourneys(user.id) || [];
  if (!journeys.length) return null;

  let nextDeadline = null, nextDeparture = null;
  const trips = [];
  for (const j of journeys) {
    const tasks = Q.getJourneyTasks(j.id) || [];
    const docs = Q.getWalletDocs(user.id) || [];
    const r = computeReadiness(j, tasks, docs);
    const next = tasks.find(t => t.status !== 'done' && t.deadline && t.deadline >= today);
    if (next && (!nextDeadline || next.deadline < nextDeadline.deadline)) {
      nextDeadline = { title: next.title, deadline: next.deadline, dest: j.dest_name || j.destination_code };
    }
    if (j.departure_date && j.departure_date >= today && (!nextDeparture || j.departure_date < nextDeparture.date)) {
      nextDeparture = { date: j.departure_date, dest: j.dest_name || j.destination_code };
    }
    trips.push({ dest: j.dest_name || j.destination_code, flag: j.dest_flag || '', r });
  }

  let openCases = 0; const caseKinds = [];
  try {
    const rows = Q.queryAllSafe(`SELECT kind, COUNT(*) as count FROM journey_cases WHERE user_id=? AND status='open' GROUP BY kind ORDER BY count DESC`, [user.id]);
    for (const c of rows) { openCases += c.count; caseKinds.push(`${c.count} × ${String(c.kind).replace(/_/g, ' ')}`); }
  } catch {}

  // Nothing actionable → no digest at all
  if (!trips.some(t => t.r.done > 0) && !openCases && !nextDeadline) return null;

  const statusLabel = { ready: 'Ready to fly', on_track: 'On track', needs_attention: 'Needs attention', behind: 'Behind schedule', not_started: 'Just getting started' };
  const tripBlocks = trips.map(t => `
    <div style="margin:0 0 12px;padding:12px 16px;border:1px solid #eee;border-radius:10px">
      <div style="font-weight:600">${t.flag} ${t.dest} — readiness ${t.r.score}% <span style="color:#888;font-weight:400">(${statusLabel[t.r.status] || t.r.status})</span></div>
      <div style="font-size:13px;color:#555">${t.r.done}/${t.r.total} tasks done${t.r.overdue ? ` · <span style="color:#B3282D">${t.r.overdue} overdue</span>` : ''}</div>
    </div>`).join('');

  const items = [];
  if (openCases) items.push(`<li><b>${openCases} open case${openCases === 1 ? '' : 's'}</b> to review — ${caseKinds.slice(0, 3).join(', ')}</li>`);
  if (nextDeadline) items.push(`<li>Next deadline: <b>“${nextDeadline.title}”</b> — ${nextDeadline.deadline} (${nextDeadline.dest})</li>`);
  if (nextDeparture) items.push(`<li>Departure <b>${nextDeparture.date}</b> — ${nextDeparture.dest}</li>`);
  items.push(`<li>Reminder: the <b>6-month passport rule</b> applies to most destinations — check your wallet expiry dates.</li>`);

  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee;border-radius:14px;overflow:hidden">
    <div style="background:#0A1428;color:#F7F3EA;padding:18px 24px;font-size:15px;font-weight:600">🌍 Your week with ${appName}</div>
    <div style="padding:20px 24px;color:#222;line-height:1.7">
      ${tripBlocks}
      <ul style="margin:6px 0 0;padding-left:18px">${items.join('')}</ul>
      <p style="margin:16px 0 0"><a href="${appUrl}/dashboard#journey" style="background:#0A1428;color:#F7F3EA;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:600;display:inline-block">Open My Journey →</a></p>
      <p style="margin:18px 0 0;font-size:12px;color:#999">Weekly digest — switch it off anytime in Profile → Preferences.</p>
    </div>
  </div>`;
}

/** Monday-only, opt-out aware, once-per-week dedup. Returns {notifs, emails}. */
async function sendWeeklyDigests() {
  let notifs = 0, emails = 0;
  // Runs on Mondays; set JOURNEY_FORCE_DIGEST=1 to test the digest any day
  const isMonday = new Date().getDay() === 1 || process.env.JOURNEY_FORCE_DIGEST === '1';
  const digestOn = String((Q.getSettingsByGroup('notifications') || {}).notif_email_digest) === '1';
  if (!isMonday || !digestOn) return { notifs, emails };

  const users = Q.queryAllSafe(`SELECT * FROM users WHERE status='active'`);
  const appName = Q.getSetting('app_name') || BRAND.NAME;
  const appUrl = (Q.getSetting('app_url') || '').replace(/\/$/, '');

  for (const user of users) {
    if (user.email_opt_out || user.digest_opt_out) continue;
    const html = digestHtmlFor(user, appName, appUrl);
    if (!html) continue;
    if (notifyOnce(`digest:${user.id}:${isoWeek(new Date())}`, user.id,
      `🌍 Your week with ${appName}`, 'Your weekly trip readiness digest is ready. Open My Journey to see deadlines and open cases.', 'digest')) {
      notifs++;
      try {
        const { sendEmail } = require('../utils/mailer');
        await sendEmail({ to: user.email, subject: `${appName} · Your week ahead`, html });
        emails++;
      } catch (e) {
        if (!sendWeeklyDigests._warned) { console.warn('[journey-digest] email skipped:', e.message); sendWeeklyDigests._warned = true; }
      }
    }
  }
  return { notifs, emails };
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

    let notifications = 0, casesOpened = 0, emails = 0;

    for (const j of journeys) {
      const user = Q.getUserById(j.user_id);
      if (!user || user.status === 'banned') continue;

      // ── Task reminders ──────────────────────────────────────────────────
      const tasks = Q.getJourneyTasks(j.id) || [];
      for (const t of tasks) {
        if (t.status === 'done' || !t.deadline) continue;
        const days = Math.ceil((new Date(t.deadline) - new Date(today)) / 86400000);
        if (days === 0 || days === 1 || days === 2 || days === 3) {
          if (notifyOnce(`rem:task:${t.id}`, j.user_id,
            `⏰ ${j.dest_flag || ''} ${j.dest_name || j.destination_code}: task due ${days === 0 ? 'today' : 'in ' + days + ' day(s)'}`,
            `${t.title}\n${t.detail || ''}\n\nOpen My Journey to tick it off.`)) {
            notifications++;
            if (await emailReminder(user, `Task due ${days === 0 ? 'today' : 'in ' + days + ' day(s)'}`,
              'A checklist task is due',
              [`<b>${t.title}</b>`, t.detail || '', `Trip: ${j.dest_name || j.destination_code} · deadline ${t.deadline}`])) emails++;
          }
        } else if (days < 0) {
          // overdue: weekly nag with ISO-week key
          if (notifyOnce(`rem:overdue:${t.id}:${isoWeek(new Date())}`, j.user_id,
            `⚠️ Overdue: ${j.dest_name || j.destination_code} — ${t.title}`,
            `This task was due ${t.deadline} and is still open. ${t.detail || ''}`)) {
            notifications++;
            if (await emailReminder(user, 'Overdue task', 'A checklist task is overdue',
              [`<b>${t.title}</b> was due ${t.deadline} and is still open.`, t.detail || ''])) emails++;
          }
        }
      }

      // ── Departure countdowns (T-30/14/7/1) ──────────────────────────────
      if (j.departure_date) {
        const depDays = Math.ceil((new Date(j.departure_date) - new Date(today)) / 86400000);
        if ([30, 14, 7, 1].includes(depDays)) {
          if (notifyOnce(`rem:dep:${j.id}:${depDays}`, j.user_id,
            `🛫 ${j.dep_flag || j.dest_flag || ''} ${j.dest_name || j.destination_code} — ${depDays} day(s) to departure`,
            depDays === 1 ? 'Final checks: online check-in, printed documents, money split. Safe travels!'
              : `Check your Journey readiness and clear any overdue tasks this week.`)) {
            notifications++;
            if (await emailReminder(user, `${depDays} days to departure`,
              `${j.dest_name || j.destination_code} is getting close`,
              depDays === 1
                ? ['Final checks: online check-in, printed documents, money split.', 'Safe travels! 🌍']
                : [`Your trip departs in <b>${depDays} days</b>.`, 'Clear any overdue checklist tasks this week so readiness stays on track.'])) emails++;
          }
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

    // ── Weekly digest (Mondays) ────────────────────────────────────────────
    const digest = await sendWeeklyDigests();

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

    if (notifications || casesOpened || digest.emails || digest.notifs) {
      persist();
      console.log(`[journey-reminders] ${notifications} reminder(s), ${casesOpened} case(s) opened${emails ? ', ' + emails + ' email(s)' : ''}${digest.emails ? `, digest: ${digest.notifs} notif(s), ${digest.emails} email(s)` : ''}`);
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

module.exports = { startJourneyScheduler, runOnce, digestHtmlFor, sendWeeklyDigests };
