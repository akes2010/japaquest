'use strict';
/**
 * Concierge service — SLA logic + branded email alerts.
 *
 * SLA: first-response targets per priority, from config/brand.js SLA_POLICY.
 * Emails: traveller confirmation on new ticket, alert to the concierge inbox
 * on new tickets/traveller replies, reply notice to the traveller — all
 * respect the user's concierge_emails pref and the admin master toggles.
 */
const BRAND = require('../config/brand');
const { slaFor } = BRAND;

// ── SLA computation ──────────────────────────────────────────────────────────
const parseUtc = s => new Date(String(s || '').replace(/Z$/, '') + 'Z').getTime();
function slaState(ticket, now = new Date()) {
  const sla = slaFor(ticket.priority);
  const dueAt = new Date(parseUtc(ticket.created_at) + sla.hours * 3600000);
  const minsLeft = Math.round((dueAt - now) / 60000);
  if (ticket.first_response_at || ticket.status === 'closed') {
    const respMins = Math.round((parseUtc(ticket.first_response_at || ticket.updated_at) - parseUtc(ticket.created_at)) / 60000);
    return { key: 'ok', label: respMins >= 0 && respMins <= sla.hours * 60 ? `Responded in ${fmt(respMins)}` : 'Responded', color: '#4a7c59', mins_left: minsLeft, hours: sla.hours };
  }
  if (minsLeft < 0) return { key: 'breached', label: `SLA breached ${fmt(-minsLeft)} ago`, color: '#c0392b', mins_left: minsLeft, hours: sla.hours };
  if (minsLeft <= sla.hours * 60 * 0.25) return { key: 'due-soon', label: `Due in ${fmt(minsLeft)}`, color: '#d35400', mins_left: minsLeft, hours: sla.hours };
  return { key: 'on-track', label: `Due in ${fmt(minsLeft)}`, color: '#6b705c', mins_left: minsLeft, hours: sla.hours };
}
const fmt = m => (m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

// ── Email plumbing ───────────────────────────────────────────────────────────
function masterEnabled(kind) {
  const { Q } = require('../db');
  if (kind === 'traveller') return Q.getSetting('notif_email_concierge_user') !== '0';
  return Q.getSetting('notif_email_concierge_admin') !== '0';
}

function wrapEmail(title, bodyHtml, cta) {
  const { Q } = require('../db');
  const name = Q.getSetting('app_name') || BRAND.NAME;
  const appUrl = (Q.getSetting('app_url') || '').replace(/\/$/, '');
  return `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px;color:#2b2620">
  <h2 style="color:#1a1a1a;border-bottom:2px solid #b8860b;padding-bottom:8px">${title}</h2>
  ${bodyHtml}
  ${cta && appUrl ? `<p style="margin-top:20px"><a href="${appUrl}${cta}" style="background:#b8860b;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;display:inline-block">Open ${name}</a></p>` : ''}
  <p style="margin-top:24px;font-size:12px;color:#8a8378">${name} — ${BRAND.TAGLINE}</p>
</div>`;
}

async function send({ to, subject, title, bodyHtml, cta }) {
  const { Q } = require('../db');
  if (!to) return false;
  try {
    const { sendEmail } = require('./mailer');
    await sendEmail({ to, subject, html: wrapEmail(title, bodyHtml, cta) });
    return true;
  } catch (e) {
    console.error(`[concierge-email] send failed (${to}): ${e.message}`);
    return false;
  }
}

function ticketUrl(id) { return `/dashboard.html#concierge`; }

// ── Alert hooks (fire-and-forget; callers must not block on them) ────────────
async function onNewTicket(ticket, user) {
  const { Q } = require('../db');
  const sla = slaFor(ticket.priority);
  const subjectLine = `[#${ticket.id}] ${ticket.subject}`;
  const firstFile = Q.queryAllSafe("SELECT file_name FROM concierge_replies WHERE ticket_id=? AND author_role='user' AND file_name!='' ORDER BY id LIMIT 1", [ticket.id])[0];
  const details = `<p><strong>Category:</strong> ${esc(ticket.category)} · <strong>Priority:</strong> ${sla.label} (first response within ${sla.hours}h)</p>
  ${ticket.message ? `<p style="white-space:pre-wrap">${esc(ticket.message)}</p>` : ''}${firstFile ? `\n  <p>📎 Attachment: ${esc(firstFile.file_name)}</p>` : ''}`;

  // Traveller confirmation (unless opted out)
  if (user && user.concierge_emails !== 0 && Number(user.concierge_emails ?? 1) !== 0 && masterEnabled('traveller')) {
    await send({
      to: user.email,
      subject: `✅ We received your request — ${subjectLine}`,
      title: `Request received — #${ticket.id}`,
      bodyHtml: `<p>Hi ${esc(user.name || 'traveller')},</p>
<p>Our concierge team has your request <strong>"${esc(ticket.subject)}"</strong> and will reply inside the app within <strong>${sla.hours} hour(s)</strong> (${sla.label} priority).</p>`,
      cta: ticketUrl(ticket.id),
    });
  }

  // Admin / concierge-inbox alert
  if (masterEnabled('admin')) {
    const adminEmail = Q.getSetting('concierge_notify_email') || Q.getSetting('support_email') || '';
    if (adminEmail) {
      await send({
        to: adminEmail,
        subject: `🤝 New ${sla.label} ticket ${subjectLine} — ${user ? (user.name || user.email) : ''}`,
        title: `New concierge request — #${ticket.id}`,
        bodyHtml: `<p><strong>${esc(user ? (user.name || user.email) : 'Traveller')}</strong> opened a ${sla.label.toLowerCase()} request:</p>${details}`,
        cta: `/admin.html#concierge`,
      });
    }
  }
}

async function onTravellerReply(ticket, user, reply) {
  if (!masterEnabled('admin')) return;
  const { Q } = require('../db');
  const adminEmail = Q.getSetting('concierge_notify_email') || Q.getSetting('support_email') || '';
  if (!adminEmail) return;
  await send({
    to: adminEmail,
    subject: `💬 Traveller reply — [#${ticket.id}] ${ticket.subject}`,
    title: `Traveller replied — #${ticket.id}`,
    bodyHtml: `<p><strong>${esc(user.name || user.email)}</strong> on <strong>"${esc(ticket.subject)}"</strong>:</p><p style="white-space:pre-wrap">${esc(reply.body)}</p>${reply.file_name ? `<p>📎 Attachment: ${esc(reply.file_name)}</p>` : ''}`,
    cta: `/admin.html#concierge`,
  });
}

async function onAgentReply(ticket, user, reply) {
  if (!user || user.concierge_emails === 0 || Number(user.concierge_emails ?? 1) === 0) return;
  if (!masterEnabled('traveller')) return;
  await send({
    to: user.email,
    subject: `🤝 Concierge replied — [#${ticket.id}] ${ticket.subject}`,
    title: `Your concierge has replied — #${ticket.id}`,
    bodyHtml: `<p>Hi ${esc(user.name || 'traveller')},</p><p><strong>${esc(reply.author_name || 'Concierge')}</strong> replied to your request <strong>"${esc(ticket.subject)}"</strong>:</p><p style="white-space:pre-wrap">${esc(reply.body)}</p>${reply.file_name ? `<p>📎 Attachment: ${esc(reply.file_name)}</p>` : ''}`,
    cta: ticketUrl(ticket.id),
  });
}

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

module.exports = { slaState, onNewTicket, onTravellerReply, onAgentReply, fmt };
