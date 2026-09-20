'use strict';
/**
 * Geo-targeted delivery for scheduled social posts.
 *
 * Targeting works on two levels:
 *  - target_countries: ISO codes (NG, GH, KE…) — matched against the passport
 *    codes of the seeded audience (passports table) and user country codes.
 *  - target_regions: Africa, Europe, Middle East… — matched against the
 *    destination regions of the visa database.
 *
 * Audience = registered users whose passport/country matches the targeting,
 * counted per region/country so the admin can preview reach before posting.
 */
const { Q } = require('../db');
const { publishViaWebhook, publishDirect } = require('./social');
const { tagUtm } = require('./utm');

// Region → ISO country codes (used for region matching on passports/users)
const REGIONS = {
  Africa: ['NG','GH','KE','ZA','ET','CM','TZ','UG','SN','RW','EG','MA','DZ','TN','LY','SD','AO','MZ','ZM','ZW','BW','NA','ML','BF','CI','NE','TD','GA','CG','CD','BJ','TG','LR','SL','GM','GW','GN','MW','LS','SZ','KM','MG','MU','SC','CV','ST','ER','DJ','SO','SS'],
  Europe: ['UK','GB','IE','FR','DE','NL','BE','LU','CH','AT','IT','ES','PT','DK','NO','SE','FI','IS','PL','CZ','SK','HU','RO','BG','GR','HR','SI','EE','LV','LT','MT','CY'],
  'Middle East': ['AE','SA','QA','KW','OM','BH','JO','LB','IL','PS','IQ','IR','TR','YE'],
  Asia: ['IN','CN','JP','KR','TH','MY','SG','ID','PH','VN','PK','BD','LK','NP','KH','LA','MM','MN','KZ','UZ'],
  Americas: ['US','CA','MX','BR','AR','CL','CO','PE','BB','JM','TT','DO','CR','PA','GY','SR'],
  Oceania: ['AU','NZ','FJ','PG'],
};

function regionsForCountry(code) {
  return Object.entries(REGIONS)
    .filter(([, codes]) => codes.includes(String(code || '').toUpperCase()))
    .map(([r]) => r);
}

/**
 * Describe the audience a post targets, for reach preview in the admin UI.
 * Returns { users, byRegion, byCountry, note }.
 */
function describeAudience(targetCountries, targetRegions) {
  const countries = (targetCountries || []).map(c => String(c).toUpperCase());
  const regions = (targetRegions || []).map(r => String(r));
  const anyone = !countries.length && !regions.length;

  const users = Q.getAllUsers(1, 100000, '').users || [];
  const byCountry = {};
  let matched = 0;
  for (const u of users) {
    const code = (u.passport_code || '').toUpperCase();
    const uRegions = regionsForCountry(code);
    const cHit = countries.includes(code);
    const rHit = regions.some(r => uRegions.includes(r));
    if (cHit || rHit) { matched++; byCountry[code || u.country || '??'] = (byCountry[code || u.country || '??'] || 0) + 1; }
  }

  // Seeded passport coverage from the visa database (targeting reach beyond
  // registered users)
  const passports = Q.getPassports() || [];
  const seededMatch = passports.filter(p => {
    const code = (p.code || '').toUpperCase();
    return countries.includes(code) || regions.some(r => (REGIONS[r] || []).includes(code));
  });

  return {
    anyone,
    matchedUsers: matched,
    totalUsers: users.length,
    byCountry,
    seededPassports: seededMatch.length,
    note: anyone
      ? 'Public — no targeting. Shared to social platforms only; no in-app delivery.'
      : `Targets ${matched}/${users.length} registered users` +
        (seededMatch.length ? ` and matches ${seededMatch.length} passport markets in the visa database.` : '.'),
  };
}

/**
 * Deliver a due post: webhook auto-publish (if configured) + in-app
 * notifications for targeted users. Returns per-platform results.
 */
async function deliverPost(post) {
  const platforms = JSON.parse(post.platforms_json || '[]');
  const campaign = `post_${post.id}`;
  const results = [];

  // 1) Direct platform posting where configured (real auto-publish), then
  //    webhook fallback for platforms without a direct integration.
  for (const p of platforms) {
    // Per-platform UTM-tagged link so traffic is attributable per network
    const link = post.link_url ? tagUtm(post.link_url, { source: p, medium: 'social', campaign, content: p }) : '';
    let res = await publishDirect(p, post.content, link);
    if (res) { results.push(res); continue; }
    res = await publishViaWebhook(p, post.content, link);
    results.push({ ...res, utm_url: link || undefined });
  }

  // 2) Geo-targeted in-app notification (if any targeting set)
  const targetCountries = JSON.parse(post.target_countries_json || '[]');
  const targetRegions = JSON.parse(post.target_regions_json || '[]');
  if (targetCountries.length || targetRegions.length) {
    const countries = targetCountries.map(c => String(c).toUpperCase());
    const users = Q.getAllUsers(1, 100000, '').users || [];
    const inAppLink = post.link_url ? tagUtm(post.link_url, { source: 'in-app', medium: 'in-app', campaign }) : '';
    let notified = 0;
    for (const u of users) {
      const code = (u.passport_code || '').toUpperCase();
      const uRegions = regionsForCountry(code);
      if (countries.includes(code) || targetRegions.some(r => uRegions.includes(r))) {
        try {
          Q.createNotification(u.id, post.title, post.content + (inAppLink ? `\n\n${inAppLink}` : ''), 'info');
          notified++;
        } catch {}
      }
    }
    results.push({ platform: 'in-app', ok: true, notified });
  }

  return results;
}

module.exports = { REGIONS, regionsForCountry, describeAudience, deliverPost };
