'use strict';
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const path    = require('path');
const fs      = require('fs');
const { requireAdmin } = require('../middleware/auth');
const { Q } = require('../db');
const { sendEmail, testSmtp } = require('../utils/mailer');
const { getOverrides, getEffectivePartners, clearPartnerCache } = require('../ai/affiliates');
const { PLATFORMS, shareLinks } = require('../utils/social');
const { socialDirectConfig } = require('../utils/social');
const { tagUtm } = require('../utils/utm');
const { REGIONS, describeAudience, deliverPost } = require('../utils/social-delivery');

router.use(requireAdmin);

// ── STATS ─────────────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => res.json(Q.getAdminStats()));

// ── SETTINGS ──────────────────────────────────────────────────────────────────
router.get('/settings/:group', (req, res) => {
  const settings = Q.getSettingsByGroup(req.params.group);
  const MASK = ['smtp_pass','ai_anthropic_key','ai_openrouter_key','ai_huggingface_key','ai_groq_key','ai_gemini_key','ai_together_key','ai_openai_key','ai_deepseek_key'];
  for (const k of MASK) { if (settings[k]) settings[k] = '••••'+settings[k].slice(-4); }
  res.json({ settings });
});

router.put('/settings', (req, res) => {
  try {
    const updates = { ...req.body };
    const MASK = ['smtp_pass','ai_anthropic_key','ai_openrouter_key','ai_huggingface_key','ai_groq_key','ai_gemini_key','ai_together_key','ai_openai_key','ai_deepseek_key'];
    for (const k of MASK) { if (updates[k]?.startsWith('••••')) delete updates[k]; }
    Q.setSettings(updates);
    res.json({ message: 'Settings saved' });
  } catch(e) { res.status(500).json({ error: 'Failed: '+e.message }); }
});

// ── AFFILIATE PARTNERS ────────────────────────────────────────────────────
// Travelpayouts partner links, editable from the admin panel. Stored as
// aff_partner_<id> JSON rows in the settings table (group 'affiliates').
const AFFILIATE_GROUP = 'affiliates';

function saveAffiliateOverride(id, data) {
  Q.setSetting(`aff_partner_${id}`, data === null ? null : JSON.stringify(data), AFFILIATE_GROUP);
}

router.get('/affiliates', (_req, res) => {
  const partners = Object.values(getEffectivePartners()).map(p => ({
    id: p.id,
    name: p.name,
    icon: p.icon || '🔗',
    tag: p.tag || 'Travel',
    type: p.type || 'misc',
    url: p.url,
    blurb: p.blurb || '',
    keywords: p.keywords || [],
    enabled: p.enabled !== false,
  }));
  res.json({ partners });
});

router.put('/affiliates/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!id) return res.status(400).json({ error: 'Partner id required' });
    const { name, icon, tag, type, url, blurb, keywords, enabled } = req.body || {};
    if (url && !/^https?:\/\/\S+$/i.test(String(url).trim())) {
      return res.status(400).json({ error: 'URL must start with http:// or https://' });
    }
    const kw = keywords == null ? undefined
      : String(keywords).split(',').map(s => s.trim()).filter(Boolean).slice(0, 30);
    const patch = {};
    if (name != null) patch.name = String(name).trim().slice(0, 80);
    if (icon != null) patch.icon = String(icon).slice(0, 8) || '🔗';
    if (tag != null) patch.tag = String(tag).trim().slice(0, 40);
    if (type != null) patch.type = String(type).trim().slice(0, 20);
    if (url != null) patch.url = String(url).trim();
    if (blurb != null) patch.blurb = String(blurb).trim().slice(0, 200);
    if (kw !== undefined) patch.keywords = kw;
    if (enabled != null) patch.enabled = !!enabled;
    // When the admin only flips the enabled toggle, preserve blurb/keywords
    if (Object.keys(patch).length === 1 && 'enabled' in patch) {
      const current = getEffectivePartners()[id];
      if (current) { patch.blurb = current.blurb; patch.keywords = current.keywords; }
    }
    const overrides = getOverrides();
    const merged = overrides[id] ? { ...overrides[id], ...patch } : { ...patch };
    saveAffiliateOverride(id, Object.keys(merged).length ? merged : null);
    clearPartnerCache();
    res.json({ message: 'Partner saved' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/affiliates/stats', (_req, res) => {
  res.json(Q.getAffiliateClickStats(30));
});

router.delete('/affiliates/:id', (req, res) => {
  const id = String(req.params.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!id) return res.status(400).json({ error: 'Partner id required' });
  if (!getEffectivePartners()[id]) return res.status(404).json({ error: 'Partner not found' });
  saveAffiliateOverride(id, null);
  clearPartnerCache();
  res.json({ message: 'Partner removed' });
});

// ── LOGO UPLOAD ────────────────────────────────────────────────────────────────
router.post('/upload/logo', (req, res) => {
  try {
    const multer = require('multer');
    const uploadDir = path.join(__dirname, '../public/uploads');
    fs.mkdirSync(uploadDir, { recursive: true });

    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename:    (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, 'logo'+ext);
      },
    });
    const upload = multer({
      storage,
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = /\.(jpg|jpeg|png|svg|webp|gif)$/i.test(file.originalname);
        cb(ok ? null : new Error('Only image files allowed'), ok);
      },
    }).single('logo');

    upload(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const logoUrl = '/uploads/' + req.file.filename;
      Q.setSetting('app_logo_url', logoUrl);
      res.json({ url: logoUrl, message: 'Logo uploaded successfully' });
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── TEST SMTP ─────────────────────────────────────────────────────────────────
router.post('/settings/test-email', async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Recipient required' });
    await testSmtp(to);
    res.json({ message: `Test email sent to ${to} ✅` });
  } catch(e) { res.status(400).json({ error: 'SMTP failed: '+e.message }); }
});

// ── TEST AI ────────────────────────────────────────────────────────────────────
router.post('/settings/test-ai', async (req, res) => {
  try {
    const fetch = require('node-fetch');
    const { model } = req.body;

    if (model === 'claude') {
      const key = Q.getSetting('ai_anthropic_key');
      if (!key) return res.status(400).json({ error: 'Anthropic key not set' });
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
        body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:10, messages:[{role:'user',content:'Hi'}] }),
      });
      if (!r.ok) { const e=await r.json().catch(()=>({})); throw new Error(e?.error?.message||`Status ${r.status}`); }
      return res.json({ message: '✅ Anthropic key is valid!' });
    }
    if (['deepseek','qwen','llama','gemma','mistral'].includes(model)) {
      const key = Q.getSetting('ai_openrouter_key');
      if (!key) return res.status(400).json({ error: 'OpenRouter key not set' });
      const r = await fetch('https://openrouter.ai/api/v1/models', { headers:{Authorization:`Bearer ${key}`} });
      if (!r.ok) throw new Error(`Status ${r.status}`);
      return res.json({ message: '✅ OpenRouter key is valid!' });
    }
    if (model === 'openai') {
      const key = Q.getSetting('ai_openai_key');
      if (!key) return res.status(400).json({ error: 'OpenAI key not set' });
      const r = await fetch('https://api.openai.com/v1/models', { headers:{Authorization:`Bearer ${key}`} });
      if (!r.ok) throw new Error(`Status ${r.status}`);
      return res.json({ message: '✅ OpenAI key is valid!' });
    }
    if (model === 'deepseek2') {
      const key = Q.getSetting('ai_deepseek_key');
      if (!key) return res.status(400).json({ error: 'DeepSeek key not set' });
      const r = await fetch('https://api.deepseek.com/models', { headers:{Authorization:`Bearer ${key}`} });
      if (!r.ok) throw new Error(`Status ${r.status}`);
      return res.json({ message: '✅ DeepSeek key is valid!' });
    }
    if (model === 'groq' || ['llama-groq','mixtral-groq'].includes(model)) {
      const key = Q.getSetting('ai_groq_key');
      if (!key) return res.status(400).json({ error: 'Groq key not set' });
      const r = await fetch('https://api.groq.com/openai/v1/models', { headers:{Authorization:`Bearer ${key}`} });
      if (!r.ok) throw new Error(`Status ${r.status}`);
      return res.json({ message: '✅ Groq key is valid!' });
    }
    if (model === 'gemini' || ['gemini-flash','gemini-pro'].includes(model)) {
      const key = Q.getSetting('ai_gemini_key');
      if (!key) return res.status(400).json({ error: 'Gemini key not set' });
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (!r.ok) throw new Error(`Status ${r.status}`);
      return res.json({ message: '✅ Gemini key is valid!' });
    }
    if (model === 'together' || model === 'llama-together') {
      const key = Q.getSetting('ai_together_key');
      if (!key) return res.status(400).json({ error: 'Together AI key not set' });
      const r = await fetch('https://api.together.xyz/v1/models', { headers:{Authorization:`Bearer ${key}`} });
      if (!r.ok) throw new Error(`Status ${r.status}`);
      return res.json({ message: '✅ Together AI key is valid!' });
    }
    if (['mistral7b','zephyr'].includes(model)) {
      const key = Q.getSetting('ai_huggingface_key');
      if (!key) return res.status(400).json({ error: 'HuggingFace token not set' });
      return res.json({ message: '✅ HuggingFace token saved (tested on first use)' });
    }
    res.status(400).json({ error: 'Unknown model' });
  } catch(e) { res.status(400).json({ error: 'Test failed: '+e.message }); }
});

// ── USERS ─────────────────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const { page=1, limit=20, search='' } = req.query;
  res.json(Q.getAllUsers(parseInt(page), parseInt(limit), search));
});
router.get('/users/:id', (req, res) => {
  const user = Q.getUserById(parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { password_hash, ...safe } = user;
  res.json({ user: safe, plan: Q.getPlanById(user.plan_id), todayUsage: Q.getTodayUsage(user.id) });
});
router.put('/users/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const user = Q.getUserById(id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const allowed = ['name','email','plan_id','status','role','country','country_flag'];
    const fields = {};
    for (const k of allowed) { if (req.body[k] !== undefined) fields[k] = req.body[k]; }
    if (fields.email) {
      fields.email = fields.email.toLowerCase();
      const dupe = Q.getUserByEmail(fields.email);
      if (dupe && dupe.id !== id) return res.status(409).json({ error: 'Email already in use by another account' });
    }
    if (fields.plan_id) fields.plan_id = parseInt(fields.plan_id);
    Q.updateUser(id, fields);
    if (fields.plan_id && fields.plan_id !== user.plan_id) {
      const newPlan = Q.getPlanById(fields.plan_id);
      Q.createNotification(id, '🎉 Plan Updated', `Your plan has been updated to ${newPlan?.name||'new plan'}.`, 'success');
    }
    res.json({ message: 'Updated' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.delete('/users/:id', (req, res) => {
  const user = Q.getUserById(parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.role==='admin') return res.status(400).json({ error: 'Cannot delete admin' });
  Q.deleteUser(user.id);
  res.json({ message: 'Deleted' });
});
router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const user = Q.getUserById(parseInt(req.params.id));
    if (!user) return res.status(404).json({ error: 'Not found' });
    const newPass = req.body.password || Math.random().toString(36).slice(2,8).toUpperCase()+Math.floor(1000+Math.random()*9000);
    Q.updateUser(user.id, { password_hash: await bcrypt.hash(String(newPass), 12) });
    res.json({ message: 'Reset', new_password: String(newPass) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/users/:id/notify', (req, res) => {
  const { title, message, type='info' } = req.body;
  if (!title||!message) return res.status(400).json({ error: 'Title and message required' });
  Q.createNotification(parseInt(req.params.id), title, message, type);
  res.json({ message: 'Sent' });
});

// ── BROADCAST ─────────────────────────────────────────────────────────────────
router.post('/broadcast', (req, res) => {
  const { title, message, type='info' } = req.body;
  if (!title||!message) return res.status(400).json({ error: 'Required' });
  Q.createNotification(null, title, message, type, 1);
  res.json({ message: 'Broadcast sent' });
});

// ── PLANS ─────────────────────────────────────────────────────────────────────
router.get('/plans', (req, res) => {
  res.json({ plans: Q.getPlans().map(p=>({...p, models:JSON.parse(p.models||'[]'), features:JSON.parse(p.features||'[]')})) });
});
router.put('/plans', (req, res) => {
  try { Q.upsertPlan(req.body); res.json({ message: 'Plan saved' }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
router.delete('/plans/:id', (req, res) => {
  const plan = Q.getPlanById(parseInt(req.params.id));
  if (!plan) return res.status(404).json({ error: 'Not found' });
  if (plan.slug==='free') return res.status(400).json({ error: 'Cannot delete Free plan' });
  Q.deletePlan(parseInt(req.params.id));
  res.json({ message: 'Deleted. Users moved to Free.' });
});

// ── CONVERSATIONS ─────────────────────────────────────────────────────────────
router.get('/conversations', (req, res) => {
  const { page=1, limit=20, search='' } = req.query;
  res.json(Q.getAllConversations(parseInt(page), parseInt(limit), search));
});
router.get('/conversations/:uuid/messages', (req, res) => {
  const conv = Q.getConversationByUUID(req.params.uuid);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  res.json({ conversation: conv, messages: Q.getMessages(conv.id) });
});
router.delete('/conversations/:uuid', (req, res) => {
  const conv = Q.getConversationByUUID(req.params.uuid);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  Q.deleteConversation(conv.uuid, conv.user_id);
  res.json({ message: 'Deleted' });
});

// ── EMAIL BROADCAST ───────────────────────────────────────────────────────────
router.post('/send-email', async (req, res) => {
  try {
    const { to, subject, html, all_users } = req.body;
    if (all_users) {
      const { users } = Q.getAllUsers(1, 100000, '');
      let sent=0;
      for (const u of users) { try { await sendEmail({to:u.email,subject,html}); sent++; } catch {} }
      return res.json({ message: `Email sent to ${sent} users` });
    }
    if (!to) return res.status(400).json({ error: 'Recipient required' });
    await sendEmail({ to, subject, html: html||'<p>(No body)</p>' });
    res.json({ message: `Email sent to ${to}` });
  } catch(e) { res.status(500).json({ error: 'Email failed: '+e.message }); }
});

// ── SOCIAL POSTS (marketing) ──────────────────────────────────────────────────
router.get('/social/platforms', (_req, res) => {
  const direct = socialDirectConfig();
  res.json({
    platforms: Object.entries(PLATFORMS).map(([id, p]) => ({
      id, name: p.name, icon: p.icon,
      direct: !!direct[id], // true = real auto-publish configured for this platform
    })),
    regions: Object.keys(REGIONS),
    passports: Q.getPassports().map(p => ({ code: p.code, name: p.name, flag: p.flag })),
  });
});

// Audience reach preview for the targeting picker
router.post('/social/audience', (req, res) => {
  try {
    res.json(describeAudience(req.body?.target_countries || [], req.body?.target_regions || []));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/social/posts', (_req, res) => {
  const posts = Q.getSocialPosts(100).map(p => ({
    ...p,
    platforms: JSON.parse(p.platforms_json || '[]'),
    target_countries: JSON.parse(p.target_countries_json || '[]'),
    target_regions: JSON.parse(p.target_regions_json || '[]'),
    results: JSON.parse(p.result_json || '[]'),
  }));
  res.json({ posts });
});

router.post('/social/posts', (req, res) => {
  try {
    const { title, content, platforms, target_countries, target_regions, link_url, scheduled_at } = req.body || {};
    if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
    if (!Array.isArray(platforms) || !platforms.length) return res.status(400).json({ error: 'Pick at least one platform' });
    if (link_url && !/^https?:\/\/\S+$/i.test(String(link_url))) return res.status(400).json({ error: 'Link must start with http:// or https://' });
    const status = scheduled_at ? 'scheduled' : 'draft';
    const id = Q.createSocialPost({ title, content, platforms, target_countries, target_regions, link_url, scheduled_at: scheduled_at || null, status });
    if (scheduled_at && new Date(scheduled_at) <= new Date()) {
      // Past date → deliver immediately via the scheduler path
      Q.updateSocialPost(id, { scheduled_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
    }
    res.json({ message: 'Post created', id, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/social/posts/:id', (req, res) => {
  try {
    const post = Q.getSocialPost(parseInt(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const fields = {};
    for (const k of ['title', 'content', 'link_url', 'platforms', 'target_countries', 'target_regions', 'scheduled_at']) {
      if (req.body[k] !== undefined) fields[k] = req.body[k];
    }
    if (fields.scheduled_at) { fields.status = 'scheduled'; if (new Date(fields.scheduled_at) <= new Date()) fields.scheduled_at = new Date().toISOString().slice(0, 19).replace('T', ' '); }
    Q.updateSocialPost(post.id, fields);
    res.json({ message: 'Post updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/social/posts/:id', (req, res) => {
  const post = Q.getSocialPost(parseInt(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post not found' });
  Q.deleteSocialPost(post.id);
  res.json({ message: 'Post deleted' });
});

// Publish now — webhook auto-publish + targeted in-app delivery
router.post('/social/posts/:id/publish', async (req, res) => {
  try {
    const post = Q.getSocialPost(parseInt(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const results = await deliverPost(post);
    Q.updateSocialPost(post.id, {
      status: 'posted',
      posted_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      result_json: JSON.stringify(results),
    });
    res.json({ message: 'Published', results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Prefilled one-click composer links per platform (links include the post
// URL UTM-tagged per platform so manual shares are attributable too)
router.get('/social/posts/:id/share-links', (req, res) => {
  const post = Q.getSocialPost(parseInt(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const base = post.link_url || '';
  const links = shareLinks(post.content, base ? tagUtm(base, { source: 'share', medium: 'social', campaign: `post_${post.id}` }) : '');
  res.json({ links });
});

// ── TOOL RESULTS (admin view) ──────────────────────────────────────────────────
router.get('/tool-results', (req, res) => {
  const { type, limit=100 } = req.query;
  // Return all tool results with user info
  res.json({ message: 'Use per-user endpoint /api/user/tools' });
});

// ── VISA EDITOR (Japa Console) ───────────────────────────────────────────────
router.post('/visa-rules', (req, res) => {
  try {
    const out = Q.upsertVisaRule(req.body || {});
    if (!out) return res.status(400).json({ error: 'Passport and destination codes required' });
    res.json({ message: 'Rule saved', ...out });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/destinations', (req, res) => {
  try {
    const code = Q.upsertDestination(req.body || {});
    if (!code) return res.status(400).json({ error: 'Country code and name required' });
    res.json({ message: 'Destination saved', code });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
