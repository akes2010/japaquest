'use strict';
/**
 * Concierge — human assistance tickets.
 *
 * Travellers escalate from the AI chat (or open a request directly); admins
 * answer from the admin Concierge queue. Every turn notifies the other side
 * in-app so nothing sits unseen.
 *
 *   POST /api/concierge/tickets           — create a request
 *   GET  /api/concierge/tickets           — my tickets
 *   GET  /api/concierge/tickets/:id       — ticket + thread (owner)
 *   POST /api/concierge/tickets/:id/reply — traveller reply (→ open, admins pinged)
 *   POST /api/concierge/tickets/:id/close — traveller closes the ticket
 */
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Q } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { onNewTicket, onTravellerReply } = require('../utils/concierge');

const CATEGORIES = ['general', 'visa', 'travel', 'study', 'work', 'move', 'business'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const MAX_UPLOAD = 10 * 1024 * 1024; // 10 MB, mirrors wallet uploads
const DOC_MIME = {
  '.pdf':'application/pdf', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.doc':'application/msword',
  '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const esc = s => String(s || '').replace(/[<>]/g, '');

function notifyAdmins(title, message, type = 'concierge') {
  const admins = Q.queryAllSafe(`SELECT id FROM users WHERE role='admin' AND status='active'`);
  for (const a of admins) Q.createNotification(a.id, title, message, type);
}

function uploadDir() {
  const dir = Q.getSetting('upload_dir') || './data/uploads';
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Read the request body. Three shapes:
//   • application/json      → express.json already parsed it into req.body; no file
//   • raw file + X-Meta hdr → X-Meta is base64 JSON with the form fields; body is the attachment
//   • anything else         → treated as a bare attachment (X-File-Name header)
// Calls cb(fileOrNull); form fields are always available on req.body afterwards.
function readUpload(req, res, cb) {
  const isJson = String(req.headers['content-type'] || '').includes('application/json');
  if (isJson) return cb(null); // express.json already handled it — no file
  const metaHdr = req.headers['x-meta'];
  if (metaHdr) { try { req.body = JSON.parse(Buffer.from(String(metaHdr), 'base64').toString('utf8') || '{}'); } catch { req.body = {}; } }
  const chunks = [];
  let size = 0;
  req.on('data', c => { size += c.length; if (size > MAX_UPLOAD) { req.destroy(); res.status(413).json({ error: 'File too large (max 10 MB)' }); } else chunks.push(c); });
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    if (!buf.length) { if (!req.body) req.body = {}; return cb(null); }
    const safeName = String(req.headers['x-file-name'] || 'attachment.pdf').replace(/[^\w.\- ]/g, '_').slice(0, 120);
    const useExt = (path.extname(safeName).toLowerCase() || '.pdf');
    if (!DOC_MIME[useExt]) return res.status(400).json({ error: 'Allowed types: PDF, PNG, JPG, WEBP, DOC, DOCX' });
    const fname = `cc_${crypto.randomBytes(8).toString('hex')}${useExt}`;
    const fpath = path.join(uploadDir(), fname);
    fs.writeFileSync(fpath, buf);
    if (!req.body) req.body = {};
    cb({ file_name: safeName, file_path: fpath, file_size: buf.length, file_mime: DOC_MIME[useExt] });
  });
}

// ── Create a request (optionally with an attachment) ─────────────────────────
router.post('/tickets', requireAuth, (req, res) => {
  readUpload(req, res, (file) => {
    const { subject, category, priority, message, journey_id } = req.body || {};
    if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'Subject is required' });
    const cat = CATEGORIES.includes(category) ? category : 'general';
    const prio = PRIORITIES.includes(priority) ? priority : 'normal';
    const id = Q.createConciergeTicket(req.user.id, { subject: String(subject).slice(0, 160), category: cat, journey_id, priority: prio });
    if ((message && String(message).trim()) || file) {
      Q.addConciergeReply(id, 'user', req.user.name || req.user.email, String(message || '').slice(0, 4000), file);
    }
    Q.setConciergeTicketStatus(id, 'open');
    notifyAdmins(`🤝 New ${prio === 'normal' ? '' : prio + ' '}concierge request`, `${req.user.name || req.user.email}: ${String(subject).slice(0, 120)}`, 'concierge');
    const ticket = Q.getConciergeTicket(id, req.user.id);
    onNewTicket(ticket, req.user).catch(() => {});
    res.json({ message: 'Request received — a human concierge will reply here.', ticket });
  });
});

// ── My tickets ────────────────────────────────────────────────────────────────
router.get('/tickets', requireAuth, (req, res) => {
  res.json({ tickets: Q.getConciergeTickets(req.user.id) });
});

// ── Ticket + thread (owner only) ──────────────────────────────────────────────
router.get('/tickets/:id', requireAuth, (req, res) => {
  const t = Q.getConciergeTicket(parseInt(req.params.id), req.user.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  res.json({ ticket: t, replies: Q.getConciergeReplies(t.id) });
});

// Download a reply attachment (participant only — never a public URL)
router.get('/attachments/:replyId', requireAuth, (req, res) => {
  const r = Q.queryAllSafe('SELECT * FROM concierge_replies WHERE id=?', [parseInt(req.params.replyId)])[0];
  if (!r || !r.file_path) return res.status(404).json({ error: 'No attachment' });
  const t = Q.getConciergeTicket(r.ticket_id, req.user.id); // enforces ownership
  if (!t && req.user.role !== 'admin') return res.status(404).json({ error: 'Ticket not found' });
  if (!fs.existsSync(r.file_path)) return res.status(410).json({ error: 'File missing from storage' });
  res.setHeader('Content-Type', r.file_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${r.file_name || 'attachment'}"`);
  res.sendFile(path.resolve(r.file_path));
});

// ── Traveller reply ───────────────────────────────────────────────────────────
router.post('/tickets/:id/reply', requireAuth, (req, res) => {
  const t = Q.getConciergeTicket(parseInt(req.params.id), req.user.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (t.status === 'closed') return res.status(400).json({ error: 'Ticket is closed — open a new request if you still need help' });
  readUpload(req, res, (file) => {
    const body = String((req.body || {}).body || '').trim();
    if (!body && !file) return res.status(400).json({ error: 'Message or attachment is required' });
    Q.addConciergeReply(t.id, 'user', req.user.name || req.user.email, body.slice(0, 4000), file);
    Q.setConciergeTicketStatus(t.id, 'open'); // back to the agent's queue
    notifyAdmins('💬 Concierge reply', `${req.user.name || req.user.email} replied to #${t.id}: ${esc(body).slice(0, 100)}`, 'concierge');
    onTravellerReply(t, req.user, { body, file_name: file?.file_name }).catch(() => {});
    res.json({ message: 'Reply sent', ticket: Q.getConciergeTicket(t.id, req.user.id) });
  });
});

// ── Close (traveller confirms it's resolved) ─────────────────────────────────
router.post('/tickets/:id/close', requireAuth, (req, res) => {
  const t = Q.getConciergeTicket(parseInt(req.params.id), req.user.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  Q.setConciergeTicketStatus(t.id, 'closed');
  Q.addConciergeReply(t.id, 'agent', 'System', `Ticket closed by ${req.user.name || 'traveller'}. Re-open any time with a new request.`);
  res.json({ message: 'Ticket closed — thanks for letting us know ✅' });
});

module.exports = router;
