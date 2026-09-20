'use strict';
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { Q } = require('../db');

// ── CONVERSATIONS ────────────────────────────────────────────────────────────
router.get('/conversations', requireAuth, (req, res) => {
  const { page=1, limit=20 } = req.query;
  res.json(Q.getConversations(req.user.id, parseInt(page), parseInt(limit)));
});
router.post('/conversations', requireAuth, (req, res) => {
  const { model } = req.body;
  const plan = Q.getPlanById(req.user.plan_id);
  const planModels = JSON.parse(plan?.models||'["claude"]');
  const finalModel = (model && (planModels.includes(model)||req.user.role==='admin'))
    ? model : (Q.getSetting('ai_default_model')||'claude');
  const uuid = Q.createConversation(req.user.id, finalModel);
  res.status(201).json({ conversation: Q.getConversation(uuid, req.user.id) });
});
router.get('/conversations/:uuid', requireAuth, (req, res) => {
  const conv = Q.getConversation(req.params.uuid, req.user.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ conversation: conv, messages: Q.getMessages(conv.id) });
});
router.put('/conversations/:uuid', requireAuth, (req, res) => {
  const conv = Q.getConversation(req.params.uuid, req.user.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  if (req.body.title) Q.updateConversationTitle(req.params.uuid, req.body.title);
  res.json({ message: 'Updated' });
});
router.delete('/conversations/:uuid', requireAuth, (req, res) => {
  Q.deleteConversation(req.params.uuid, req.user.id);
  res.json({ message: 'Deleted' });
});

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
router.get('/notifications', requireAuth, (req, res) => {
  res.json({ notifications: Q.getNotifications(req.user.id), unread: Q.getUnreadCount(req.user.id) });
});
router.put('/notifications/read-all', requireAuth, (req, res) => {
  Q.markAllRead(req.user.id); res.json({ message: 'Done' });
});
router.put('/notifications/:id/read', requireAuth, (req, res) => {
  Q.markRead(parseInt(req.params.id), req.user.id); res.json({ message: 'Done' });
});

// ── STATS ────────────────────────────────────────────────────────────────────
router.get('/stats', requireAuth, (req, res) => {
  const plan = Q.getPlanById(req.user.plan_id);
  res.json({
    today: Q.getTodayUsage(req.user.id),
    limit: plan?.daily_limit ?? 10,
    plan: plan?.name ?? 'Free',
    totalConversations: Q.getConversations(req.user.id).total,
    usageHistory: Q.getUserUsageStats(req.user.id, 30),
  });
});

// ── PLANS (public) ────────────────────────────────────────────────────────────
router.get('/plans', (_req, res) => {
  const plans = Q.getPlans().filter(p=>p.active).map(p=>({
    id:p.id, name:p.name, slug:p.slug, price:p.price,
    daily_limit:p.daily_limit, badge:p.badge,
    models: JSON.parse(p.models||'[]'),
    features: JSON.parse(p.features||'[]'),
  }));
  res.json({ plans });
});

// ── TOOL RESULTS ──────────────────────────────────────────────────────────────

// POST /api/user/tools — save a tool result
router.post('/tools', requireAuth, (req, res) => {
  try {
    const { tool_type, title, input_data, result_text } = req.body;
    if (!tool_type || !result_text) {
      return res.status(400).json({ error: 'tool_type and result_text required' });
    }
    const id = Q.saveToolResult(req.user.id, tool_type, title||tool_type, input_data||{}, result_text);
    res.status(201).json({ id, message: 'Saved to your history' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/user/tools — list tool results
router.get('/tools', requireAuth, (req, res) => {
  const { type, limit=50 } = req.query;
  res.json({ results: Q.getToolResults(req.user.id, type||null, parseInt(limit)) });
});

// GET /api/user/tools/:id — get one result
router.get('/tools/:id', requireAuth, (req, res) => {
  const result = Q.getToolResult(parseInt(req.params.id), req.user.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json({ result });
});

// DELETE /api/user/tools/:id — delete a result
router.delete('/tools/:id', requireAuth, (req, res) => {
  Q.deleteToolResult(parseInt(req.params.id), req.user.id);
  res.json({ message: 'Deleted' });
});

module.exports = router;
