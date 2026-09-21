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
const { Q } = require('../db');
const { requireAuth } = require('../middleware/auth');
const BRAND = require('../config/brand');

const CATEGORIES = ['general', 'visa', 'travel', 'study', 'work', 'move', 'business'];
const esc = s => String(s || '').replace(/[<>]/g, '');

function notifyAdmins(title, message, type = 'concierge') {
  const admins = Q.queryAllSafe(`SELECT id FROM users WHERE role='admin' AND status='active'`);
  for (const a of admins) Q.createNotification(a.id, title, message, type);
}

// ── Create a request ──────────────────────────────────────────────────────────
router.post('/tickets', requireAuth, (req, res) => {
  const { subject, category, message, journey_id } = req.body || {};
  if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'Subject is required' });
  const cat = CATEGORIES.includes(category) ? category : 'general';
  const id = Q.createConciergeTicket(req.user.id, { subject: String(subject).slice(0, 160), category: cat, journey_id });
  if (message && String(message).trim()) {
    Q.addConciergeReply(id, 'user', req.user.name || req.user.email, String(message).slice(0, 4000));
  }
  Q.setConciergeTicketStatus(id, 'open');
  notifyAdmins('🤝 New concierge request', `${req.user.name || req.user.email}: ${String(subject).slice(0, 120)}`, 'concierge');
  res.json({ message: 'Request received — a human concierge will reply here.', ticket: Q.getConciergeTicket(id, req.user.id) });
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

// ── Traveller reply ───────────────────────────────────────────────────────────
router.post('/tickets/:id/reply', requireAuth, (req, res) => {
  const t = Q.getConciergeTicket(parseInt(req.params.id), req.user.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (t.status === 'closed') return res.status(400).json({ error: 'Ticket is closed — open a new request if you still need help' });
  const body = String((req.body || {}).body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message is required' });
  Q.addConciergeReply(t.id, 'user', req.user.name || req.user.email, body.slice(0, 4000));
  Q.setConciergeTicketStatus(t.id, 'open'); // back to the agent's queue
  notifyAdmins('💬 Concierge reply', `${req.user.name || req.user.email} replied to #${t.id}: ${esc(body).slice(0, 100)}`, 'concierge');
  res.json({ message: 'Reply sent', ticket: Q.getConciergeTicket(t.id, req.user.id) });
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
