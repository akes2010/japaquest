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

module.exports = { PLATFORMS, shareLinks, publishViaWebhook, WEBHOOK_ENV };
