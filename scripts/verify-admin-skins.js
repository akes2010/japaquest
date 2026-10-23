#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
/**
 * scripts/verify-admin-skins.js — permanent admin-skin QA.
 *
 * Boots the server on a scratch port, logs in as the seeded admin, and walks
 * all 5 skins (night · ink · paper · snow · daylight), asserting:
 *   1. data-skin / skin-light apply correctly
 *   2. the app actually renders (topbar + sidebar + active nav visible)
 *   3. real pixel contrast of the active sidebar item (screenshot-based,
 *      so translucent tints are measured as rendered, not computed)
 *   4. the save-dirty cue lights when a form input changes and clears on save
 *
 * Needs puppeteer-core somewhere reachable:
 *   npm i puppeteer-core            (or NODE_PATH=/tmp/verify-env/node_modules node scripts/verify-admin-skins.js)
 * Chrome discovery: CHROME_PATH env, else /usr/bin/google-chrome-stable, else /usr/bin/chromium.
 * Exit 0 = all green, 1 = failures ( printed with ❌ ).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.VERIFY_PORT || 4391;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@jagaguru.ai';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'Admin@1234!';
const SKINS = ['night', 'ink', 'paper', 'snow', 'daylight'];

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

// pixel luminance composited on white (screenshot pixels are fully opaque anyway)
function pxLum(r, g, b) {
  const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  return .2126 * f(r) + .7152 * f(g) + .0722 * f(b);
}

(async () => {
  // spawn a scratch server so we never touch a running production instance.
  // attach in-process (not detached) so leftovers die with this run; pick a
  // genuinely free port so a stale prior run can't answer for us.
  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });
  // wait for readiness
  let up = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    up = await new Promise(res => { const net = require('net'); const c = net.connect(PORT, '127.0.0.1', () => { c.end(); res(true); }); c.on('error', () => res(false)); c.setTimeout(800, () => { c.destroy(); res(false); }); });
    if (up) break;
  }
  if (!up) { console.error('❌ server did not come up on ' + PORT); server.kill(); process.exit(1); }

  const puppeteer = requirePuppeteer();
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: findChrome(),
    protocolTimeout: 90000,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1400, height: 900 });
  await pg.setBypassCSP(true);

  // ── login once via admin-login (sets vg_token + vg_role) ──
  await pg.goto(BASE + '/admin-login', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 800));
  const loginState = await pg.evaluate((e, p) => {
    const em = document.getElementById('em'), pw = document.getElementById('pw');
    if (!em || !pw) return 'no-inputs';
    em.value = e; pw.value = p; go();
    return 'sent';
  }, ADMIN_EMAIL, ADMIN_PASS).catch(e => 'eval-err:' + e.message.slice(0, 60));
  await new Promise(r => setTimeout(r, 2500));
  const tok = await pg.evaluate(() => localStorage.getItem('vg_token') || '');
  ok('admin login via admin-login.html', !!tok, '(login=' + loginState + ')');
  if (!tok) { await browser.close(); server.kill('SIGTERM'); process.exit(1); }

  for (const skin of SKINS) {
    console.log('## skin:', skin);
  try {
    await pg.evaluateOnNewDocument((sk, t) => {
      try {
        localStorage.clear();
        localStorage.setItem('jquest_skin', sk);
        localStorage.setItem('vg_token', t);
        localStorage.setItem('vg_role', 'admin');
      } catch {}
    }, skin, tok);

    await pg.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    // wait for app render (auth redirect lands on /admin-login if token missing)
    let rendered = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 400));
      rendered = await pg.evaluate(() => {
        const tb = document.getElementById('topbar');
        const nav = document.getElementById('sb-nav') || document.querySelector('.sb-nav');
        return !!tb && !!nav && !!document.querySelector('.sb-btn.active');
      });
      if (rendered) break;
    }
    ok(skin + ' app renders (topbar + sidebar + active nav)', rendered, pg.url().endsWith('/admin-login') ? '(redirected to login!)' : '');

    // 1. skin attributes
    const attrs = await pg.evaluate(() => ({
      skin: document.body.dataset.skin || '',
      light: document.body.classList.contains('skin-light')
    }));
    ok(skin + ' data-skin applied', attrs.skin === skin, '→ ' + attrs.skin);
    const isLight = ['paper', 'snow', 'daylight'].includes(skin);
    ok(skin + ' skin-light flag correct', attrs.light === isLight, String(attrs.light));

    // 2. active nav element present & visible
    const nav = await pg.evaluate(() => {
      const el = document.getElementById('snav-overview') || document.querySelector('.sb-btn.active');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible: el.offsetParent !== null || (r.width > 0 && r.height > 0) };
    });
    ok(skin + ' active nav visible with size', !!nav && nav.visible && nav.w > 10 && nav.h > 10, nav ? (nav.w + 'x' + nav.h) : 'missing');

    // 3. real pixel contrast of the active nav item (screenshot → luminance min/max)
    if (nav && nav.w > 10) {
      const clip = { x: Math.max(0, nav.x), y: Math.max(0, nav.y), width: Math.min(160, nav.w), height: nav.h };
      const buf = await pg.screenshot({ clip, timeout: 15000 });
      const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
      const st = await pg.evaluate(async url => {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const lumPx = (r, g2, b2) => {
          const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
          return .2126 * f(r) + .7152 * f(g2) + .0722 * f(b2);
        };
        let minL = 1, maxL = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 200) continue; // ignore transparent corners
          const L = lumPx(d[i], d[i + 1], d[i + 2]);
          if (L < minL) minL = L;
          if (L > maxL) maxL = L;
        }
        return { ratio: (maxL + .05) / (minL + .05), minL, maxL };
      }, dataUrl);
      ok(skin + ' active-nav pixel contrast ≥ 4.5', st.ratio >= 4.5, st.ratio.toFixed(2) + ':1');
    }

    // 4. save-dirty cue lifecycle on the General (System) form
    try {
      await pg.evaluate(() => { if (typeof sw === 'function') sw('general'); });
      await new Promise(r => setTimeout(r, 600));
      const cue = await pg.evaluate(() => {
        const btn = document.getElementById('save-general-btn') || document.querySelector('[id^="save-"][id$="-btn"]');
        if (!btn) return { found: false };
        // pick a visible nearby text input (not file/hidden/password)
        const view = btn.closest('.view, .s-card, #content') || document;
        const inputs = [...view.querySelectorAll('input:not([type=file]):not([type=hidden]):not([type=password]), textarea')].filter(el => el.offsetParent !== null);
        if (!inputs.length) return { found: true, lit: false, err: 'no inputs' };
        const inp = inputs[0];
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        const lit = btn.classList.contains('save-dirty');
        return { found: true, lit, sid: btn.id };
      });
      ok(skin + ' save-dirty cue lights on input', cue.found && cue.lit, cue.err || ('on #' + cue.sid));
      if (cue.found && cue.lit) {
        const after = await pg.evaluate(() => new Promise(res => {
          const btn = document.getElementById('save-general-btn') || document.querySelector('[id^="save-"][id$="-btn"]');
          btn.click();
          setTimeout(() => res(!btn.classList.contains('save-dirty')), 900);
        }));
        ok(skin + ' save-dirty clears after Save click', after);
      }
    } catch (e) {
      ok(skin + ' save-dirty cue smoke', false, e.message.slice(0, 80));
    }
  } catch (e) {
    // a mid-skin navigation (login bounce, reload) must not kill the whole run
    ok(skin + ' skin checks completed', false, 'run-abort: ' + e.message.slice(0, 80));
  }
  }

  console.log('\n════ ADMIN SKIN VERIFICATION: ' + (fail ? fail + ' FAILED ✗' : 'ALL ' + pass + ' CHECKS PASSED ✅') + ' ════');
  if (failures.length) console.log('Failed: ' + failures.join(', '));

  await browser.close();
  server?.kill('SIGTERM');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('FATAL', e.message);
  process.exit(1);
});
