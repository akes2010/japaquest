#!/usr/bin/env node
'use strict';
/**
 * scripts/verify-admin-mobile.js — permanent phone-UX QA for the admin app.
 * Boots a scratch server, logs in, and asserts at real viewports that the
 * sidebar drawer + scrim (#sb-ov) behave:
 *   phone 375px — admin interactable on load; ☰/topbar stays tappable while
 *   the drawer is open (scrim z149 < topbar z151 < #sb z200, scrim inside
 *   #app so the app's z-index:1 context can't bury it); drawer closes on
 *   scrim tap; scrim inert (opacity 0, pointer-events:none) when closed.
 *   desktop 1440px — scrim inert, sidebar in normal layout.
 * Needs puppeteer-core (same convention as verify-admin-skins.js).
 * Exit 0 = green, 1 = failures.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

(async () => {
  const puppeteer = requirePuppeteer();
  const PORT = process.env.VERIFY_PORT || 4397;
  const BASE = 'http://127.0.0.1:' + PORT;
  function findChrome() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    for (const p of ['/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']) if (fs.existsSync(p)) return p;
    throw new Error('No Chrome found. Set CHROME_PATH=/path/to/chrome');
  }
  function requirePuppeteer() {
    try { return require('puppeteer-core'); }
    catch {
      const alt = '/tmp/verify-env/node_modules/puppeteer-core';
      if (fs.existsSync(alt)) return require(alt);
      throw new Error('puppeteer-core not installed — npm i puppeteer-core (dev) or NODE_PATH to its node_modules');
    }
  }
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 500)); if (await new Promise(res => { const c = require('net').connect(PORT, '127.0.0.1', () => { c.end(); res(true); }); c.on('error', () => res(false)); })) break; }
  const browser = await puppeteer.launch({ headless: true, executablePath: findChrome(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let pass = 0, fail = 0; const fails = [];
  const ok = (n, c, ex) => { if (c) { pass++; console.log(' ✅', n, ex || ''); } else { fail++; fails.push(n); console.log(' ❌', n, ex || ''); } };

  const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.ADMIN_EMAIL || 'admin@jagaguru.ai', password: process.env.ADMIN_PASSWORD || 'Admin@1234!' }) });
  const lb = await lr.json().catch(() => ({}));
  const tok = lb.token || (lb.user && lb.user.token) || '';
  ok('admin API login', lr.status === 200 && !!tok, lr.status);

  const pg = await browser.newPage();
  await pg.evaluateOnNewDocument(t => { try { localStorage.setItem('vg_token', t); localStorage.setItem('vg_role', 'admin'); } catch {} }, tok);

  // ── phone 375px ──
  await pg.setViewport({ width: 375, height: 720, isMobile: true, hasTouch: true });
  await pg.goto(BASE + '/admin', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
  let rendered = false;
  for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 400)); rendered = await pg.evaluate(() => !!document.getElementById('topbar') && !!document.querySelector('.sb-btn.active')); if (rendered) break; }
  ok('admin renders at 375px', rendered, pg.url());

  const probe = () => pg.evaluate(() => {
    const pick = (x, y) => { const el = document.elementFromPoint(x, y); return el ? el.tagName + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '') : 'NONE'; };
    const mb = document.querySelector('.menu-btn');
    const mr = mb ? mb.getBoundingClientRect() : null;
    const ov = document.getElementById('sb-ov');
    const cs = ov ? getComputedStyle(ov) : null;
    const sb = document.getElementById('sb');
    const sr = sb ? sb.getBoundingClientRect() : null;
    return {
      bodyCls: document.body.className,
      center: pick(window.innerWidth / 2, window.innerHeight / 2),
      topbar: pick(window.innerWidth / 2, 20),
      menuBtn: mr ? pick(mr.x + mr.width / 2, mr.y + mr.height / 2) : 'NO-BTN',
      scrimBox: cs ? cs.display + '/' + cs.opacity + '/pe:' + cs.pointerEvents : 'NO-SCRIM',
      sbVisibleX: sr ? Math.round(sr.x) : -9999,
      sbW: sr ? Math.round(sr.width) : 0
    };
  });

  let st = await probe();
  ok('fresh load: admin points clickable (not covered by scrim)', !/sb-ov/.test(st.center + st.topbar + st.menuBtn), JSON.stringify(st));
  ok('fresh load: scrim inert (opacity 0, pointer-events:none)', st.scrimBox === 'block/0/pe:none', st.scrimBox);

  // open drawer via ☰
  await pg.evaluate(() => document.querySelector('.menu-btn').click());
  await new Promise(r => setTimeout(r, 450));
  st = await probe();
  ok('drawer opens on ☰ tap (sb-open + drawer on-screen)', st.bodyCls.includes('sb-open') && st.sbVisibleX >= 0, JSON.stringify(st));
  ok('scrim visible while drawer open (opacity 1, pointer-events:auto)', st.scrimBox.includes('pe:auto'), st.scrimBox);
  ok('☰ stays tappable while drawer open (topbar above scrim)', !/sb-ov/.test(st.menuBtn), 'menuBtn@ ' + st.menuBtn);

  // tap scrim → drawer closes
  await pg.evaluate(() => { const ov = document.getElementById('sb-ov'); ov.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
  await new Promise(r => setTimeout(r, 450));
  st = await probe();
  ok('scrim tap closes drawer + admin interactive again', !st.bodyCls.includes('sb-open') && !/sb-ov/.test(st.center + st.menuBtn), JSON.stringify(st));

  // reopen and click a sidebar link → drawer closes after nav
  await pg.evaluate(() => document.querySelector('.menu-btn').click());
  await new Promise(r => setTimeout(r, 400));
  const navInfo = await pg.evaluate(() => {
    const btn = document.querySelector('#sb .sb-btn');
    if (!btn) return { found: false };
    btn.click();
    return { found: true, id: btn.id };
  });
  await new Promise(r => setTimeout(r, 500));
  st = await probe();
  ok('sidebar nav works from drawer + drawer closes after nav', navInfo.found && !st.bodyCls.includes('sb-open'), JSON.stringify(navInfo) + ' / ' + st.bodyCls);

  // ── desktop 1440px sanity ──
  await pg.setViewport({ width: 1440, height: 900 });
  await new Promise(r => setTimeout(r, 700));
  st = await probe();
  ok('desktop: scrim inert, sidebar on-screen (normal layout)', !st.bodyCls.includes('sb-open') && !/sb-ov/.test(st.center) && st.sbVisibleX >= 0, JSON.stringify(st));

  console.log('\n════ ADMIN MOBILE VERIFY: ' + (fail ? fail + ' FAILED ✗' : 'ALL ' + pass + ' CHECKS PASSED ✅') + ' ════');
  if (fails.length) console.log('Failed: ' + fails.join(' | '));
  await browser.close();
  server.kill('SIGTERM');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
