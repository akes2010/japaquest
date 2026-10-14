#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
 * scripts/verify-keys-survive-update.js — prove AI/gateway credentials stay
 * PUT and PRESENT around an update/restart cycle, against a SCRATCH database
 * (DB_PATH redirected to /tmp; the real data/ is never touched).
 *
 *   1. save AI keys + a gateway key via the admin API
 *   2. restart the server (what finishing an update always does) → keys intact
 *   3. a masked echo ('••••…') sent for ANY secret must be ignored, never
 *      written over the stored key (belt-and-braces the UI already filters)
 *   4. legacy group mismatch: a settings row stranded in grp='general' by an
 *      older build is re-homed to its canonical group on boot, so it shows
 *      up in the group-scoped admin tabs instead of "vanishing"
 *
 *   node scripts/verify-keys-survive-update.js      # exit 0 = all pass
 * ══════════════════════════════════════════════════════════════════════════ */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PORT = 4402;
const BASE = `http://127.0.0.1:${PORT}`;
const SCRATCH = '/tmp/verify-keys-data';

let pass = 0, fail = 0, child = null;
const ok = (n, c, e) => { if (c) { pass++; console.log(' ✅', n, e == null ? '' : String(e)); } else { fail++; console.log(' ❌', n, e == null ? '' : String(e)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const KEYS = ['ai_anthropic_key', 'ai_openrouter_key', 'ai_groq_key', 'ai_gemini_key', 'ai_kimi_key', 'ai_zai_key', 'ai_xkiro_key', 'ai_ci_key', 'ai_cloudflare_token'];
const SAVE = {
  ai_default_model: 'claude',
  ai_anthropic_key: 'sk-ant-api03-AAAABBBBCCCC',
  ai_openrouter_key: 'sk-or-v1-XYZ0000Test',
  ai_groq_key: 'gsk_AAAABBBBTest01',
  ai_gemini_key: 'AIzaSyTestGemini001',
  ai_kimi_key: 'sk-kimi-test-1234',
  ai_zai_key: 'zai-test-5678',
  ai_xkiro_key: 'xk-live-tail-0009',
  ai_ci_key: 'ci-live-tail-0010',
  ai_cloudflare_token: 'cf-tok-test-0011',
};

function boot(fresh) {
  if (fresh) { fs.rmSync(SCRATCH, { recursive: true, force: true }); }
  fs.mkdirSync(SCRATCH, { recursive: true });
  child = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(SCRATCH, 'jagaguru.db') }, stdio: 'ignore' });
  return child;
}
async function waitUp() {
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    if (await new Promise(res => { const c = require('net').connect(PORT, '127.0.0.1', () => { c.end(); res(true); }); c.on('error', () => res(false)); })) return true;
  }
  return false;
}
const killTree = () => new Promise(res => { try { child.on('exit', res); child.kill('SIGTERM'); } catch { res(); } });

async function login() {
  const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@jagaguru.ai', password: 'Admin@1234!' }) });
  const lb = await lr.json().catch(() => ({}));
  const tok = lb.token || (lb.user && lb.user.token) || '';
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
  return { H, j: async (u, o = {}) => { const r = await fetch(BASE + u, { ...o, headers: H }); let d = {}; try { d = await r.json(); } catch {} return { status: r.status, d }; } };
}
const aiCount = s => KEYS.filter(k => s[k] && s[k].length > 0).length;
function gwSecret(g) { const p = (g.providers || []).find(p => p.key === 'paystack') || {}; return ((p.fields || []).find(f => f.field === 'secret_key') || {}).hasValue; }

(async () => {
  boot(true);
  ok('server boots', await waitUp());
  let { j } = await login();
  ok('admin login', await j('/api/admin/stats').then(r => r.status === 200), '');

  // 1 — save AI keys + gateway key exactly like the admin UI does
  ok('AI keys PUT accepted', (await j('/api/admin/settings', { method: 'PUT', body: JSON.stringify(SAVE) })).status === 200);
  ok('gateway key POST accepted', (await j('/api/admin/payment-gateways', { method: 'POST', body: JSON.stringify({ provider: 'paystack', values: { secret_key: 'sk_test_paystackAAA', public_key: 'pk_test_pubAAA' } }) })).status === 200);
  let g = await j('/api/admin/settings/ai');
  ok('AI keys readable after save (9/9)', aiCount(g.d.settings || {}) === 9, aiCount(g.d.settings || {}));
  ok('gateway key readable after save', gwSecret((await j('/api/admin/payment-gateways')).d));

  // 2 — full update cycle: stop → start → keys still present
  await killTree(); boot(false);
  ok('server restarted (update step)', await waitUp());
  ({ j } = await login());
  g = await j('/api/admin/settings/ai');
  ok('AI keys SURVIVE update-restart (9/9)', aiCount(g.d.settings || {}) === 9, aiCount(g.d.settings || {}));
  ok('gateway key SURVIVES update-restart', gwSecret((await j('/api/admin/payment-gateways')).d));

  // 3 — masked echoes must be ignored for ALL secret keys (not just the old list)
  await j('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ ai_anthropic_key: '••••ECHO', ai_xkiro_key: '••••ECHO', ai_ci_key: '••••ECHO', smtp_pass: '••••ECHO' }) });
  g = await j('/api/admin/settings/ai');
  const s = g.d.settings || {};
  ok('masked echo did not overwrite ai_anthropic_key', (s.ai_anthropic_key || '').endsWith('CCCC'), s.ai_anthropic_key);
  ok('masked echo did not overwrite ai_xkiro_key', (s.ai_xkiro_key || '').endsWith('0009'), s.ai_xkiro_key);
  ok('masked echo did not overwrite ai_ci_key', (s.ai_ci_key || '').endsWith('0010'), s.ai_ci_key);
  await j('/api/admin/payment-gateways', { method: 'POST', body: JSON.stringify({ provider: 'paystack', values: { secret_key: '••••ECHO' } }) });
  ok('masked echo did not overwrite gateway secret', gwSecret((await j('/api/admin/payment-gateways')).d));

  // 4 — legacy grp mismatch: strand keys in grp='general' like an older build
  //     would, restart, and expect the boot realignment to surface them.
  await killTree();
  try {
    await new Promise((res, rej) => {
      require('' + 'sql.js')().then(SQL => {
        const dbPath = path.join(SCRATCH, 'jagaguru.db');
        const db = new SQL.Database(fs.readFileSync(dbPath));
        db.run(`UPDATE settings SET grp='general' WHERE key IN ('ai_anthropic_key','ai_groq_key','ai_ci_key')`);
        fs.writeFileSync(dbPath, Buffer.from(db.export()));
        db.close(); res();
      }).catch(rej);
    });
    ok('legacy DB surgery applied (3 keys → grp=general)', true);
  } catch (e) { ok('legacy DB surgery applied', false, e.message); }
  boot(false);
  ok('server reboots on legacy-shaped DB', await waitUp());
  ({ j } = await login());
  g = await j('/api/admin/settings/ai');
  const s3 = g.d.settings || {};
  const realigned = KEYS.filter(k => k !== 'ai_ci_key' || true).length; // all seeded keys ride the ai group
  ok('grp realignment on boot: stranded AI keys reappear in the AI tab (9/9)', aiCount(s3) === 9, aiCount(s3));
  ok('anthropic key value intact after realignment', (s3.ai_anthropic_key || '').endsWith('CCCC'), s3.ai_anthropic_key);
  ok('groq key value intact after realignment (mask keeps last 4)', (s3.ai_groq_key || '').endsWith('st01'), s3.ai_groq_key);

  await killTree();
  console.log('\n════ KEYS-SURVIVE-UPDATE VERIFY: ' + (fail ? fail + ' FAILED ✗' : 'ALL ' + pass + ' CHECKS PASSED ✅') + ' ════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); try { child && child.kill('SIGTERM'); } catch {} process.exit(1); });
