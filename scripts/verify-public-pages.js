#!/usr/bin/env node
'use strict';
/**
 * scripts/verify-public-pages.js — permanent QA for the public/user pages.
 *
 * Boots a scratch server (no auth needed for public endpoints) and asserts:
 *   1. /api/app-info brand guard: a logoUrl that points at a missing file is
 *      dropped (stale DB rows must never surface as broken <img>); a real file
 *      is served with HTTP 200
 *   2. landing page applies the uploaded logo into every .logo-mark badge and
 *      falls back to the built-in λ glyph when there is no logo
 *   3. /manifest.json icons come from the upload when available (PWA install)
 *   4. /dashboard renders (topbar + sidebar + active nav) in the night skin
 *
 * Needs puppeteer-core reachable (same convention as verify-admin-skins.js).
 * Exit 0 = all green, 1 = failures.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.VERIFY_PORT || 4392;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅', name, extra || ''); }
  else { fail++; failures.push(name); console.log('  ❌', name, extra || ''); }
};

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const p of ['/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No Chrome found. Set CHROME_PATH=/path/to/chrome');
}
function requirePuppeteer() {
  try { return require('puppeteer-core'); }
  catch {
    const alt = '/tmp/verify-env/node_modules/puppeteer-core';
    if (fs.existsSync(alt)) return require(alt);
    throw new Error('puppeteer-core not installed — run `npm i puppeteer-core` (dev) or NODE_PATH to its node_modules');
  }
}

async function waitUp() {
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    const up = await new Promise(res => { const net = require('net'); const c = net.connect(PORT, '127.0.0.1', () => { c.end(); res(true); }); c.on('error', () => res(false)); c.setTimeout(800, () => { c.destroy(); res(false); }); });
    if (up) return true;
  }
  return false;
}

(async () => {
  const puppeteer = requirePuppeteer();
  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });
  if (!(await waitUp())) { console.error('❌ server did not come up on ' + PORT); server.kill('SIGTERM'); process.exit(1); }

  const httpJson = async p => { const r = await fetch(BASE + p); return { status: r.status, body: await r.json() }; };
  const httpGet = async p => { const r = await fetch(BASE + p); return { status: r.status, bytes: (await r.arrayBuffer()).byteLength }; };

  // helper: set the brand setting on disk DB (server's sql.js memory is per-process,
  // so each case boots its own server — see verify loop below)
  const setLogoSetting = v => new Promise((res, rej) => {
    const c = spawn('node', ['-e', `
      const { initDB, Q, persist } = require('./db');
      initDB().then(async () => { Q.setSetting('app_logo_url', ${JSON.stringify(v)}); await persist(); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });
    `], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    c.on('exit', code => code === 0 ? res() : rej(new Error('db write failed')));
  });
  // a killed server flushes its IN-MEMORY db on SIGTERM exit (db.js exit hook),
  // which would clobber a newer write made after it started dying. So: wait for
  // the dying server to FULLY EXIT (not just a timer) before the next DB write.
  const stopServer = s => new Promise(res => {
    if (!s || s.exitCode !== null) return res();
    s.on('exit', () => res());
    s.kill('SIGTERM');
    setTimeout(() => { try { s.kill('SIGKILL'); } catch {} }, 4000);
  });

  const browser = await puppeteer.launch({ headless: true, executablePath: findChrome(), protocolTimeout: 90000, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1280, height: 800 });
  await pg.setBypassCSP(true);

  const bootAndCheckLanding = async label => {
    await pg.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    return pg.evaluate(() => {
      const marks = [...document.querySelectorAll('.logo-mark')];
      const imgs = marks.filter(m => m.querySelector('img'));
      return {
        marks: marks.length,
        imgCount: imgs.length,
        src: imgs[0]?.querySelector('img')?.getAttribute('src') || '',
        glyph: marks.filter(m => m.querySelector('span')?.textContent === 'λ').length
      };
    });
  };

  // ── CASE A: real uploaded logo ──
  console.log('## case: uploaded logo present');
  try {
    // Self-sufficient fixture: uploads/ is gitignored, so a fresh clone may
    // have no PNG to point at. Create a deterministic 1x1 PNG ourselves.
    const fxPath = path.join(__dirname, '..', 'public', 'uploads', 'verify-fx-logo.png');
    fs.mkdirSync(path.dirname(fxPath), { recursive: true });
    if (!fs.existsSync(fxPath)) {
      // minimal valid 1x1 RGBA PNG
      fs.writeFileSync(fxPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    }
    const fxRel = '/uploads/verify-fx-logo.png';
    await stopServer(server);              // srv-from-boot would flush stale memory on exit
    await setLogoSetting(fxRel);           // write AFTER it is fully dead
    const srvA = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
    if (!(await waitUp())) throw new Error('case-A server not up');
    const ai = await httpJson('/api/app-info');
    ok('app-info serves real logoUrl', ai.status === 200 && ai.body.logoUrl === fxRel, ai.body.logoUrl);
    const logo = await httpGet(ai.body.logoUrl);
    ok('uploaded logo file reachable', logo.status === 200 && logo.bytes > 0, logo.status + '/' + logo.bytes + 'B');
    const man = await httpJson('/manifest.json');
    ok('PWA manifest uses uploaded logo', man.status === 200 && (man.body.icons || []).some(i => i.src === ai.body.logoUrl), JSON.stringify((man.body.icons || []).map(i => i.src)));
    const home = await bootAndCheckLanding('A');
    ok('landing renders uploaded logo in all badges', home.marks > 0 && home.imgCount === home.marks && home.src === ai.body.logoUrl, `${home.imgCount}/${home.marks}`);
    await stopServer(srvA);
  } catch (e) { ok('case A completed', false, e.message.slice(0, 90)); }

  // ── CASE B: stale path → guarded fallback ──
  console.log('## case: stale logo path (file missing)');
  try {
    await setLogoSetting('/uploads/logo.png'); // known-missing fixed name from the old scheme
    const srvB = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
    if (!(await waitUp())) throw new Error('case-B server not up');
    const ai = await httpJson('/api/app-info');
    ok('app-info drops stale logoUrl', ai.status === 200 && ai.body.logoUrl === '', JSON.stringify(ai.body.logoUrl));
    const home = await bootAndCheckLanding('B');
    ok('landing falls back to λ glyph (no broken img)', home.imgCount === 0 && home.glyph >= 1, JSON.stringify(home));
    const man = await httpJson('/manifest.json');
    ok('PWA manifest falls back to built-in icons', man.status === 200 && (man.body.icons || []).every(i => !String(i.src).startsWith('/uploads')), JSON.stringify((man.body.icons || []).map(i => i.src)));
    await stopServer(srvB);
  } catch (e) { ok('case B completed', false, e.message.slice(0, 90)); }

  // ── CASE C: dashboard renders (night skin) — needs a real user session ──
  console.log('## case: dashboard render');
  try {
    // srvB was killed at the end of case B — bring the server back up first
    const srvC = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
    if (!(await waitUp())) throw new Error('case-C server not up');
    // login as the seeded admin (dashboards render for any valid user, admins included)
    const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.ADMIN_EMAIL || 'admin@jagaguru.ai', password: process.env.ADMIN_PASSWORD || 'Admin@1234!' }) });
    const lb = await lr.json().catch(() => ({}));
    const tok = lb.token || (lb.user && lb.user.token) || '';
    ok('user API login for dashboard check', lr.status === 200 && !!tok, lr.status);
    if (tok) {
      await pg.evaluateOnNewDocument(t => { try { localStorage.setItem('jquest_skin', 'night'); localStorage.setItem('vg_token', t); } catch {} }, tok);
      await pg.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      let rendered = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 400));
        rendered = await pg.evaluate(() => !!document.getElementById('topbar') && !!document.querySelector('.sb-btn.active') && document.body.dataset.skin === 'night');
        if (rendered) break;
      }
      ok('dashboard renders with night skin active', rendered, pg.url());
    }
    await stopServer(srvC);
  } catch (e) { ok('case C completed', false, e.message.slice(0, 90)); }

  console.log('\n════ PUBLIC PAGES VERIFICATION: ' + (fail ? fail + ' FAILED ✗' : 'ALL ' + pass + ' CHECKS PASSED ✅') + ' ════');
  if (failures.length) console.log('Failed: ' + failures.join(', '));

  await browser.close();
  server.kill('SIGTERM');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('FATAL', e.message);
  process.exit(1);
});
