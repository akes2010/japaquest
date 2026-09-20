'use strict';
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { Q }   = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { sendEmail } = require('../utils/mailer');

// ── Helper: strip sensitive fields ─────────────────────────────────────────
function safeUser(user, plan) {
  return {
    id: user.id, uuid: user.uuid, name: user.name,
    email: user.email, role: user.role,
    country: user.country, country_flag: user.country_flag,
    avatar: user.avatar, status: user.status,
    last_login: user.last_login, created_at: user.created_at,
    plan: plan ? {
      id: plan.id, name: plan.name, slug: plan.slug,
      price: plan.price, daily_limit: plan.daily_limit,
      models:   JSON.parse(plan.models   || '[]'),
      features: JSON.parse(plan.features || '[]'),
      badge: plan.badge,
    } : null,
  };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    if (Q.getSetting('registration_open') === '0') {
      return res.status(403).json({ error: 'Registration is currently closed' });
    }
    const { name, email, password, country, country_flag, passport_code } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (Q.getUserByEmail(email.toLowerCase()))
      return res.status(409).json({ error: 'An account with this email already exists' });

    const hash   = await bcrypt.hash(password, 12);
    const userId = Q.createUser({ name, email: email.toLowerCase(), password_hash: hash, country, country_flag });
    const user   = Q.getUserById(userId);
    const plan   = Q.getPlanById(user.plan_id);

    Q.createNotification(userId, '🎉 Welcome to Japa+!',
      `Hi ${name}! Your account is ready. Start by asking about any visa you need.`, 'success');

    // Welcome email (best-effort)
    if (Q.getSetting('notif_welcome_email') === '1') {
      const appName = Q.getSetting('app_name') || 'Japa+';
      sendEmail({
        to: email,
        subject: `Welcome to ${appName}! ✈`,
        html: `<h2>Welcome, ${name}!</h2>
<p>Your account has been created. Start exploring expert visa guidance tailored to your passport.</p>
<p><a href="${Q.getSetting('app_url') || 'http://localhost:3000'}/dashboard">Open your dashboard →</a></p>`,
      }).catch(() => {});
    }

    // Notify admin
    if (Q.getSetting('notif_new_user_alert') === '1') {
      const adminEmail = Q.getSetting('support_email');
      if (adminEmail) {
        sendEmail({
          to: adminEmail,
          subject: 'New User Registration',
          html: `<p>New user: <strong>${name}</strong> (${email}) from ${country || 'Unknown'} just registered.</p>`,
        }).catch(() => {});
      }
    }

    const token = signToken({ uuid: user.uuid, role: user.role });
    res.json({ token, user: safeUser(user, plan) });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const user = Q.getUserByEmail(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.status === 'banned')
      return res.status(403).json({ error: 'Account suspended. Contact support.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    Q.updateLastLogin(user.id);
    const plan  = Q.getPlanById(user.plan_id);
    const token = signToken({ uuid: user.uuid, role: user.role });
    res.json({ token, user: safeUser(user, plan) });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const plan       = Q.getPlanById(req.user.plan_id);
  const todayUsage = Q.getTodayUsage(req.user.id);
  const unread     = Q.getUnreadCount(req.user.id);
  res.json({ user: safeUser(req.user, plan), todayUsage, unread });
});

// PUT /api/auth/profile
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { name, country, country_flag, passport_code } = req.body;
    const fields = {};
    if (name)           fields.name           = name;
    if (country)        fields.country        = country;
    if (country_flag)   fields.country_flag   = country_flag;
    if (passport_code)  fields.passport_code  = String(passport_code).toUpperCase().slice(0, 2);
    if (Object.keys(fields).length) Q.updateUser(req.user.id, fields);

    const updated = Q.getUserById(req.user.id);
    const plan    = Q.getPlanById(updated.plan_id);
    res.json({ user: safeUser(updated, plan) });
  } catch (e) {
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// PUT /api/auth/password
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password)
      return res.status(400).json({ error: 'Both passwords required' });
    if (new_password.length < 8)
      return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const ok = await bcrypt.compare(current_password, req.user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    Q.updateUser(req.user.id, { password_hash: hash });
    res.json({ message: 'Password updated successfully' });
  } catch (e) {
    res.status(500).json({ error: 'Password update failed' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = Q.getUserByEmail(email.toLowerCase());
    // Always respond the same — prevents email enumeration
    if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' });

    const token = crypto.randomBytes(32).toString('hex');
    Q.createResetToken(user.id, token, 1); // expires in 1 hour

    const appUrl  = Q.getSetting('app_url') || 'http://localhost:4000';
    const resetUrl = `${appUrl}/reset-password.html?token=${token}`;

    // Dev convenience: without SMTP configured, print the link so the flow is testable locally.
    if (!Q.getSetting('smtp_host') || !Q.getSetting('smtp_user')) {
      console.log(`
📧 [DEV] Password reset requested for ${email}
   Link (valid 1h): ${resetUrl}
`);
    }

    sendEmail({
      to: email,
      subject: 'Password Reset Request',
      html: `<h3>Reset your password</h3>
<p>Click the link below to reset your password. This link expires in 1 hour.</p>
<p><a href="${resetUrl}">${resetUrl}</a></p>
<p>If you did not request this, ignore this email.</p>`,
    }).catch(() => {});

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (e) {
    res.status(500).json({ error: 'Request failed' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password)
      return res.status(400).json({ error: 'Token and new password required' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const reset = Q.getResetToken(token);
    if (!reset) return res.status(400).json({ error: 'Invalid or expired reset token' });

    const hash = await bcrypt.hash(password, 12);
    Q.updateUser(reset.user_id, { password_hash: hash });
    Q.useResetToken(reset.id);
    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (e) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

module.exports = router;
