'use strict';
/**
 * Social post scheduler — publishes geo-targeted posts when due.
 *
 * Started from server.js after the DB is ready. Every SCAN_INTERVAL seconds
 * it picks up posts with status 'scheduled' whose scheduled_at has passed,
 * delivers them (webhook auto-publish + targeted in-app notifications) and
 * marks them posted with the per-platform results.
 */
const { initDB, Q, persist } = require('../db');
const { deliverPost } = require('../utils/social-delivery');

const SCAN_INTERVAL = parseInt(process.env.SOCIAL_SCAN_INTERVAL || '60') * 1000;
let timer = null;

async function runOnce() {
  try {
    await initDB(); // no-op when server.js already initialised
    const due = Q.getDueSocialPosts();
    for (const post of due) {
      try {
        const results = await deliverPost(post);
        Q.updateSocialPost(post.id, {
          status: 'posted',
          posted_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
          result_json: JSON.stringify(results),
        });
        persist();
        console.log(`[social-scheduler] posted #${post.id} "${post.title}" → ${results.length} channel(s)`);
      } catch (e) {
        console.error(`[social-scheduler] post #${post.id} failed:`, e.message);
      }
    }
  } catch (e) {
    console.error('[social-scheduler] scan failed:', e.message);
  }
}

function startSocialScheduler() {
  if (timer) return;
  runOnce(); // deliver anything already due at boot
  timer = setInterval(runOnce, SCAN_INTERVAL);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`📣 Social scheduler running (scans every ${SCAN_INTERVAL / 1000}s)`);
}

module.exports = { startSocialScheduler, runOnce };
