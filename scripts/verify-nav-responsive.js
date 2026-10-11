#!/usr/bin/env node
'use strict';
/**
 * scripts/verify-nav-responsive.js — permanent nav + responsive QA for the
 * landing page. Boots a scratch server and asserts, by real viewport:
 *   desktop 1440px — 5 aligned nav links, burger hidden, brand text, no overflow
 *   mobile  375px — hamburger + drawer, link row hidden, no overflow
 *   drawer behavior — opens with scrim, 5 links on-screen, closes + scrolls on tap
 *   narrow  320px — no overflow, logo intact
 * Needs puppeteer-core (same convention as verify-admin-skins.js). Exit 0 = green.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

(async () => {
  const puppeteer = requirePuppeteer();
  const PORT = process.env.VERIFY_PORT || 4395;
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
  const server = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 500)); if (await new Promise(res => { const c = require('net').connect(PORT, '127.0.0.1', () => { c.end(); res(true); }); c.on('error', () => res(false)); })) break; }
  const browser = await puppeteer.launch({ headless: true, executablePath: findChrome(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let pass = 0, fail = 0; const fails = [];
  const ok = (n, c, ex) => { if (c) { pass++; console.log(' ✅', n, ex || ''); } else { fail++; fails.push(n); console.log(' ❌', n, ex || ''); } };
  const pg = await browser.newPage();

  // ── 1440px desktop ──
  await pg.setViewport({ width: 1440, height: 900 });
  await pg.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1200));
  let nav = await pg.evaluate(() => {
    const link = document.querySelector('.nav-links');
    const burger = document.getElementById('nav-burger');
    const brand = document.querySelector('.brand-name');
    const l = link ? [...link.querySelectorAll('.nav-link')].map(a => { const r = a.getBoundingClientRect(); return { t: a.textContent.trim(), x: Math.round(r.x), w: Math.round(r.width), inX: r.x >= 0 }; }) : [];
    const wrap = document.querySelector('nav'); const wr = wrap ? wrap.getBoundingClientRect() : { width: 0 };
    return { links: l, burgerHidden: burger && getComputedStyle(burger).display === 'none', brand: brand?.textContent.trim(), navW: Math.round(wr.width), overflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  ok('desktop shows 5 nav links', nav.links.length === 5, nav.links.map(x => x.t).join(' | '));
  ok('desktop nav links left-aligned (no overflow/link cut)', nav.links.every(x => x.inX && x.w > 0), JSON.stringify(nav.links.slice(0, 2)));
  ok('desktop hides burger', nav.burgerHidden);
  ok('desktop brand text', nav.brand === 'JapaQuest', nav.brand);
  ok('desktop no horizontal overflow', !nav.overflow);

  // ── 375px mobile ──
  await pg.setViewport({ width: 375, height: 720 });
  await new Promise(r => setTimeout(r, 600));
  nav = await pg.evaluate(() => {
    const burger = document.getElementById('nav-burger');
    const drawer = document.getElementById('nav-drawer');
    const links = document.querySelector('.nav-links');
    return {
      burgerShown: burger && getComputedStyle(burger).display !== 'none',
      linksHidden: links && getComputedStyle(links).display === 'none',
      drawerW: Math.round(drawer.getBoundingClientRect().width),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      logoW: Math.round(document.querySelector('.logo').getBoundingClientRect().width)
    };
  });
  ok('mobile shows burger', nav.burgerShown);
  ok('mobile hides link row', nav.linksHidden);
  ok('mobile no horizontal overflow', !nav.overflow, JSON.stringify(nav));

  // drawer open/close
  await pg.click('#nav-burger');
  await new Promise(r => setTimeout(r, 450));
  let dstate = await pg.evaluate(() => {
    const d = document.getElementById('nav-drawer');
    const px = Math.round(d.getBoundingClientRect().x);
    return { open: d.classList.contains('open'), offscreenX: px, w: Math.round(d.getBoundingClientRect().width), nLinks: d.querySelectorAll('a.nav-link').length, scrim: document.getElementById('nav-scrim').classList.contains('open') };
  });
  ok('drawer opens on burger tap', dstate.open && dstate.scrim, JSON.stringify(dstate));
  ok('drawer has 5 links', dstate.nLinks === 5, String(dstate.nLinks));
  ok('drawer fully on-screen', dstate.offscreenX >= 0, 'x=' + dstate.offscreenX);
  // tap a link → drawer closes and page scrolls
  await pg.evaluate(() => { document.getElementById('nav-drawer').querySelector('a[href="#pricing"]').click(); });
  await new Promise(r => setTimeout(r, 700));
  dstate = await pg.evaluate(() => ({ closed: !document.getElementById('nav-drawer').classList.contains('open'), scrolled: window.scrollY > 100 }));
  ok('drawer closes + navigates on link tap', dstate.closed && dstate.scrolled, JSON.stringify(dstate));

  // 320px ultra-narrow sanity
  await pg.setViewport({ width: 320, height: 640 });
  await new Promise(r => setTimeout(r, 500));
  const tiny = await pg.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth, logoVisible: document.querySelector('.logo').getBoundingClientRect().width > 60 }));
  ok('320px: no overflow, logo visible', !tiny.overflow && tiny.logoVisible, JSON.stringify(tiny));

  console.log('\n════ NAV/RESPONSIVE VERIFY: ' + (fail ? fail + ' FAILED ✗' : 'ALL ' + pass + ' CHECKS PASSED ✅') + ' ════');
  if (fails.length) console.log('Failed: ' + fails.join(' | '));
  await browser.close();
  server.kill('SIGTERM');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
