'use strict';
/**
 * Social sharing toolkit.
 *
 * 1. shareLinks(text, url) — builds prefilled composer URLs for every major
 *    network. Clicking one opens the platform ready-to-post; the admin just
 *    hits Share. This is the "publish anywhere" path and works with zero API
 *    keys.
 *
 * 2. publishViaWebhook(platform, text, url) — optional auto-publish to
 *    platforms configured in the admin panel (LinkedIn company webhook etc.).
 *    Every attempt is recorded so the admin UI can show per-platform results.
 */

const PLATFORMS = {
  twitter:    { name: 'X / Twitter',   icon: '𝕏' },
  facebook:   { name: 'Facebook',      icon: '📘' },
  linkedin:   { name: 'LinkedIn',      icon: '💼' },
  whatsapp:   { name: 'WhatsApp',      icon: '💬' },
  telegram:   { name: 'Telegram',      icon: '✈️' },
  reddit:     { name: 'Reddit',        icon: '👽' },
  pinterest:  { name: 'Pinterest',     icon: '📌' },
  email:      { name: 'Email',         icon: '📧' },
  threads:    { name: 'Threads',       icon: '🧵' },
  bluesky:    { name: 'Bluesky',       icon: '🦋' },
  tumblr:     { name: 'Tumblr',        icon: '📱' },
  viber:      { name: 'Viber',         icon: '📞' },
  line:       { name: 'LINE',          icon: '💬' },
  vk:         { name: 'VK',            icon: '🇷' },
  xing:       { name: 'XING',          icon: '🌐' },
};

function shareLinks(text, url) {
  const t = String(text || '').trim();
  const u = String(url || '').trim();
  const T = encodeURIComponent(t);
  const U = encodeURIComponent(u);
  const TU = encodeURIComponent(t ? `${t} ${u}`.trim() : u);
  const links = {
    twitter:   `https://twitter.com/intent/tweet?text=${T}${u ? `&url=${U}` : ''}`,
    facebook:  `https://www.facebook.com/sharer/sharer.php?u=${U}${t ? `&quote=${T}` : ''}`,
    linkedin:  `https://www.linkedin.com/sharing/share-offsite/?url=${U}`,
    whatsapp:  `https://wa.me/?text=${TU}`,
    telegram:  `https://t.me/share/url?url=${U}${t ? `&text=${T}` : ''}`,
    reddit:    `https://www.reddit.com/submit?url=${U}${t ? `&title=${T}` : ''}`,
    pinterest: `https://pinterest.com/pin/create/button/?url=${U}${t ? `&description=${T}` : ''}`,
    email:     `mailto:?subject=${T.slice(0, 120)}${u ? `&body=${encodeURIComponent(t + '\n\n' + u)}` : ''}`,
    threads:   `https://www.threads.net/intent/post?text=${TU}`,
    bluesky:   `https://bsky.app/intent/compose?text=${TU}`,
    tumblr:    `https://www.tumblr.com/widgets/share/tool?canonicalUrl=${U}${t ? `&caption=${T}` : ''}`,
    viber:     `viber://forward?text=${TU}`,
    line:      `https://social-plugins.line.me/lineit/share?url=${U}${t ? `&text=${T}` : ''}`,
    vk:        `https://vk.com/share.php?url=${U}${t ? `&title=${T}` : ''}`,
    xing:      `https://www.xing.com/spi/shares/new?url=${U}`,
  };
  return links;
}

/** Optional webhook auto-publish. platform → env var name. */
const WEBHOOK_ENV = {
  twitter:  'SOCIAL_TWITTER_WEBHOOK',
  facebook: 'SOCIAL_FACEBOOK_WEBHOOK',
  linkedin: 'SOCIAL_LINKEDIN_WEBHOOK',
  telegram: 'SOCIAL_TELEGRAM_WEBHOOK',
  slack:    'SOCIAL_SLACK_WEBHOOK',
};

async function publishViaWebhook(platform, text, url) {
  const envName = WEBHOOK_ENV[platform];
  const hook = envName && process.env[envName];
  if (!hook) return { platform, ok: false, skipped: true, error: 'No webhook configured' };
  try {
    const fetch = require('node-fetch');
    const body = platform === 'slack'
      ? JSON.stringify({ text: `${text}\n${url || ''}`.trim() })
      : JSON.stringify({ text, url, content: `${text}\n${url || ''}`.trim() });
    const r = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return { platform, ok: r.ok, status: r.status };
  } catch (e) {
    return { platform, ok: false, error: e.message };
  }
}

// ── DIRECT POSTING APIs ───────────────────────────────────────────────────────
// Real auto-publish to the destination platform. Each returns
// { platform, ok, skipped?, status?, url?, error? } and NEVER throws.

function socialDirectConfig() {
  return {
    twitter: !!(process.env.X_API_KEY && process.env.X_API_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_SECRET),
    telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    bluesky: !!(process.env.BLUESKY_IDENTIFIER && process.env.BLUESKY_APP_PASSWORD),
    discord: !!process.env.DISCORD_WEBHOOK_URL,
  };
}

/** Post to X (Twitter) via API v2 using OAuth 1.0a user context. */
async function postToTwitter(text, url) {
  const cfg = socialDirectConfig();
  if (!cfg.twitter) return { platform: 'twitter', ok: false, skipped: true, error: 'X API keys not configured (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET)' };
  try {
    const fetch = require('node-fetch');
    const { oauth1Header } = require('./oauth1');
    const fullText = url ? `${text}\n\n${url}` : text;
    const { header } = oauth1Header({
      method: 'POST',
      url: 'https://api.twitter.com/2/tweets',
      consumerKey: process.env.X_API_KEY,
      consumerSecret: process.env.X_API_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      tokenSecret: process.env.X_ACCESS_SECRET,
    });
    const r = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': header },
      body: JSON.stringify({ text: fullText.slice(0, 280) }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { platform: 'twitter', ok: false, status: r.status, error: d.detail || d.title || `HTTP ${r.status}` };
    return { platform: 'twitter', ok: true, status: r.status, url: d.data?.id ? `https://x.com/i/web/status/${d.data.id}` : undefined };
  } catch (e) {
    return { platform: 'twitter', ok: false, error: e.message };
  }
}

/** Post to a Telegram channel/group via Bot API. */
async function postToTelegram(text, url) {
  const cfg = socialDirectConfig();
  if (!cfg.telegram) return { platform: 'telegram', ok: false, skipped: true, error: 'Telegram bot not configured (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)' };
  try {
    const fetch = require('node-fetch');
    const fullText = url ? `${text}\n${url}` : text;
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: fullText, disable_web_page_preview: false }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) return { platform: 'telegram', ok: false, status: r.status, error: d.description || `HTTP ${r.status}` };
    return { platform: 'telegram', ok: true };
  } catch (e) {
    return { platform: 'telegram', ok: false, error: e.message };
  }
}

/** Post to Bluesky (AT Protocol). Creates a session, then the post. */
async function postToBluesky(text, url) {
  const cfg = socialDirectConfig();
  if (!cfg.bluesky) return { platform: 'bluesky', ok: false, skipped: true, error: 'Bluesky not configured (BLUESKY_IDENTIFIER, BLUESKY_APP_PASSWORD)' };
  try {
    const fetch = require('node-fetch'); // node-fetch handles IPv6 fallback better than undici here
    const base = process.env.BLUESKY_PDS_URL || 'https://bsky.social';
    const s = await fetch(`${base}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: process.env.BLUESKY_IDENTIFIER, password: process.env.BLUESKY_APP_PASSWORD }),
    });
    const sd = await s.json().catch(() => ({}));
    if (!s.ok) return { platform: 'bluesky', ok: false, status: s.status, error: sd.error || sd.message || `HTTP ${s.status}` };
    const now = new Date().toISOString();
    const facets = [];
    if (url) {
      const byteLen = Buffer.byteLength(url, 'utf8');
      const u = new URL(url);
      facets.push({
        index: { byteStart: text.length + 2, byteEnd: text.length + 2 + byteLen },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
      });
      void u;
    }
    const p = await fetch(`${base}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sd.accessJwt}` },
      body: JSON.stringify({
        repo: sd.did,
        collection: 'app.bsky.feed.post',
        record: { $type: 'app.bsky.feed.post', text: url ? `${text}\n\n${url}` : text, createdAt: now, ...(facets.length ? { facets } : {}) },
      }),
    });
    const pd = await p.json().catch(() => ({}));
    if (!p.ok) return { platform: 'bluesky', ok: false, status: p.status, error: pd.error || pd.message || `HTTP ${p.status}` };
    const handle = String(process.env.BLUESKY_IDENTIFIER).replace(/^@/, '');
    const rkey = pd.uri ? pd.uri.split('/').pop() : '';
    return { platform: 'bluesky', ok: true, url: rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : undefined };
  } catch (e) {
    return { platform: 'bluesky', ok: false, error: e.message };
  }
}

/** Post to a Discord channel via webhook (text content). */
async function postToDiscord(text, url) {
  const cfg = socialDirectConfig();
  if (!cfg.discord) return { platform: 'discord', ok: false, skipped: true, error: 'Discord webhook not configured (DISCORD_WEBHOOK_URL)' };
  try {
    const fetch = require('node-fetch');
    const r = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: url ? `${text}\n${url}` : text, allowed_mentions: { parse: [] } }),
    });
    if (!r.ok) return { platform: 'discord', ok: false, status: r.status, error: `HTTP ${r.status}` };
    return { platform: 'discord', ok: true };
  } catch (e) {
    return { platform: 'discord', ok: false, error: e.message };
  }
}

/** Direct posters by platform id. */
const DIRECT_POSTERS = {
  twitter: postToTwitter,
  telegram: postToTelegram,
  bluesky: postToBluesky,
  discord: postToDiscord,
};

async function publishDirect(platform, text, url) {
  const fn = DIRECT_POSTERS[platform];
  if (!fn) return null;
  return fn(text, url);
}

module.exports = { PLATFORMS, shareLinks, publishViaWebhook, WEBHOOK_ENV, publishDirect, DIRECT_POSTERS, socialDirectConfig, postToTwitter, postToTelegram, postToBluesky, postToDiscord };
