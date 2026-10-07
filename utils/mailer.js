'use strict';
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const BRAND = require('../config/brand');

function buildTransporter() {
  const { Q } = require('../db');
  const host   = String(Q.getSetting('smtp_host') || '').trim();
  const port   = parseInt(Q.getSetting('smtp_port') || '587');
  const user   = Q.getSetting('smtp_user');
  const pass   = Q.getSetting('smtp_pass');
  const secure = Q.getSetting('smtp_secure') === '1';

  if (!host || !user || !pass) {
    throw new Error('SMTP not configured. Go to Admin → Email Settings to set it up.');
  }
  // A pasted email in the Host field fails DNS with a cryptic "queryA EBADNAME
  // <value>". Catch it here and say how to fix it: Host = mail server, the
  // email goes in Username.
  if (host.includes('@')) {
    const dom = host.split('@').pop();
    throw new Error(`SMTP Host "${host}" is an email address, not a mail server. Set Host to mail.${dom} (or your provider's SMTP host) and keep ${user} in Username.`);
  }
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

const domainOf = (addr) => (String(addr || '').split('@')[1] || '').trim().toLowerCase();

// Receiver spam filters score HTML-only mail harshly and punish tag-soup text
// alternatives, so render a clean plain-text part.
const stripHtml = (html) => String(html || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&#?\w+;/g, ' ')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/**
 * Resolve who the mail appears to come from and whether it is aligned with the
 * SMTP account. Alignment matters: sending From a domain different from the
 * authenticated mailbox (SPF/DKIM misalignment) is the single most common
 * cause of "550 … discarded as high-probability spam" on shared hosts.
 */
function resolveSender() {
  const { Q } = require('../db');
  const fromName  = Q.getSetting('smtp_from_name')  || BRAND.NAME;
  const fromEmail = (Q.getSetting('smtp_from_email') || Q.getSetting('smtp_user') || '').trim();
  const smtpUser  = (Q.getSetting('smtp_user') || '').trim();
  const fromDomain = domainOf(fromEmail);
  const smtpDomain = domainOf(smtpUser);
  const aligned = !fromEmail || !smtpDomain || fromDomain === smtpDomain;
  return { fromName, fromEmail, smtpUser, fromDomain, smtpDomain, aligned };
}

async function sendEmail({ to, subject, html, text }) {
  const { fromName, fromEmail, fromDomain, aligned, smtpDomain } = resolveSender();
  if (!fromEmail) throw new Error('No From address — set SMTP user or From email in Admin → Email Settings.');
  if (!aligned) {
    console.warn(`[mailer] ⚠️ From domain "${fromDomain}" differs from SMTP account domain "${smtpDomain}" — outgoing filters commonly discard this as spam (550). Use a mailbox on the From domain, or set From to the SMTP account's address.`);
  }

  const transporter = buildTransporter();
  return transporter.sendMail({
    from: { name: fromName, address: fromEmail },
    to,
    subject,
    html: html || `<p>${text || ''}</p>`,
    text: text || stripHtml(html),
    // Receivers distrust missing/generic Message-IDs; build ours from the From
    // domain so it matches SPF/DKIM alignment instead of the server hostname.
    messageId: `<${Date.now()}.${crypto.randomBytes(8).toString('hex')}@${fromDomain || 'localhost'}>`,
    replyTo: fromEmail,
  });
}

async function testSmtp(to) {
  const { Q } = require('../db');
  const appName = Q.getSetting('app_name') || BRAND.NAME;
  return sendEmail({
    to,
    subject: `SMTP test — ${appName}`,
    text: `Your ${appName} email configuration is working.\n\nYou received this because an administrator ran the SMTP test in the ${appName} admin panel.`,
    html: `<h2>SMTP test</h2><p>Your email configuration is working correctly.</p><p>Sent from <strong>${appName}</strong>.</p>`,
  });
}

module.exports = { sendEmail, testSmtp, resolveSender, stripHtml };
