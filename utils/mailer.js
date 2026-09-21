'use strict';
const nodemailer = require('nodemailer');
const BRAND = require('../config/brand');

function buildTransporter() {
  const { Q } = require('../db');
  const host   = Q.getSetting('smtp_host');
  const port   = parseInt(Q.getSetting('smtp_port') || '587');
  const user   = Q.getSetting('smtp_user');
  const pass   = Q.getSetting('smtp_pass');
  const secure = Q.getSetting('smtp_secure') === '1';

  if (!host || !user || !pass) {
    throw new Error('SMTP not configured. Go to Admin → Email Settings to set it up.');
  }
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

async function sendEmail({ to, subject, html, text }) {
  const { Q } = require('../db');
  const fromName  = Q.getSetting('smtp_from_name')  || BRAND.NAME;
  const fromEmail = Q.getSetting('smtp_from_email') || Q.getSetting('smtp_user') || '';

  const transporter = buildTransporter();
  return transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to, subject,
    html: html || `<p>${text || ''}</p>`,
    text: text  || (html ? html.replace(/<[^>]+>/g, '') : ''),
  });
}

async function testSmtp(to) {
  const { Q } = require('../db');
  const appName = Q.getSetting('app_name') || BRAND.NAME;
  return sendEmail({
    to,
    subject: `✅ SMTP Test — ${appName}`,
    html: `<h2>SMTP Test Successful!</h2>
<p>Your email configuration is working correctly.</p>
<p>Sent from <strong>${appName}</strong></p>`,
  });
}

module.exports = { sendEmail, testSmtp };
