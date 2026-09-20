'use strict';
/**
 * UTM tagging for social post links.
 *
 * Every outbound link from a social post is tagged so promotion traffic is
 * measurable in analytics (and in Travelpayouts dashboards, which accept
 * SubIDs for some merchants):
 *   utm_source=<platform>    e.g. twitter, telegram, in-app
 *   utm_medium=social        (or 'in-app' for targeted notifications)
 *   utm_campaign=post_<id>   the admin post id
 *   utm_content=<platform>   per-platform breakdown when source is shared
 */

function tagUtm(url, { source, medium = 'social', campaign, content } = {}) {
  const raw = String(url || '').trim();
  if (!raw) return raw;
  if (!/^https?:\/\//i.test(raw)) return raw; // mailto:, viber: etc. stay untouched
  try {
    const u = new URL(raw);
    if (source) u.searchParams.set('utm_source', String(source));
    u.searchParams.set('utm_medium', String(medium));
    if (campaign) u.searchParams.set('utm_campaign', String(campaign));
    if (content) u.searchParams.set('utm_content', String(content));
    return u.toString();
  } catch {
    return raw;
  }
}

module.exports = { tagUtm };
