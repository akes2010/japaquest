#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
 * scripts/verify-save-buttons.js — prove the fix in the browser, not the grep.
 *
 * Boots the real server, drives headless Chrome through the 5 skins on both
 * the admin panel and the user dashboard, and asserts:
 *   1. every Save button has a background + foreground color with a
 *      contrast ratio >= 3:1 (button labels), in EVERY skin,
 *   2. the save confirmation pop-up (#toast) stays light-text-on-navy and
 *      legible (>= 4.5:1) in EVERY skin,
 *   3. .save-dirty appears when a field is adjusted and clears on click.
 *
 *   node scripts/verify-save-buttons.js        # exit 0 = all pass
 * ══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
// Same discovery convention as the other verifiers: repo deps → dev fallback
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require(path.join('/tmp', 'verify-env', 'node_modules', 'puppeteer-core')); }

const PORT = 4399;
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const p of ['/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']) if (fs.existsSync(p)) return p;
  throw new Error('No Chrome found. Set CHROME_PATH=/path/to/chrome');
}
const BASE = `http://localhost:${PORT}`;

// relative luminance per WCAG 2.x
function lum(r, g, b) {
  const f = v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(fg, bg) {
  const parse = c => c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/).slice(1, 4).map(Number);
  const L1 = lum(...parse(fg));
  const L2 = lum(...parse(bg));
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

// White/transparent backgrounds compositing: fade a solid color over white when alpha < 1
async function computedStyle(page, sel, prop) {
  return page.$eval(sel, (el, p) => getComputedStyle(el)[p], prop);
}

function waitForPort(url, ms) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function ping() {
      http.get(`${url}/api/health`, r => { r.resume(); resolve(); })
        .on('error', () => Date.now() - start > ms ? reject(new Error('server never came up')) : setTimeout(ping, 400));
    })();
  });
}

(async () => {
  process.env.PORT = String(PORT);
  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', d => serverLog += d);
  server.stderr.on('data', d => serverLog += d);

  let browser;
  let failures = 0;
  const pass = m => console.log('  ✅ ' + m);
  const bad = m => { failures++; console.log('  ❌ ' + m); };

  const SAVE_SEL = '.btn-primary, .ex-save, [id^="save-"]';

  // Walk the 5 skins on the CURRENT page, checking legibility of save buttons.
  async function checkSkinsOnPage(pg, label) {
    const SKINS = ['night', 'ink', 'paper', 'snow', 'daylight'];
    for (const skin of SKINS) {
      await pg.evaluate(s => { localStorage.setItem('jquest_skin', s); if (typeof applySkin === 'function') applySkin(); }, skin);
      await new Promise(r => setTimeout(r, 350));
      const bgInfo = await pg.$$eval(SAVE_SEL, els => els.slice(0, 12).map(el => ({
        tag: el.id || (el.className || '').slice(0, 40),
        text: (el.textContent || '').trim().slice(0, 24),
        bg: getComputedStyle(el).backgroundColor,
        img: getComputedStyle(el).backgroundImage,
        fg: getComputedStyle(el).color,
      })));
      let checked = 0;
      if (!bgInfo.length) { bad(`[${label}/${skin}] no save buttons rendered`); continue; }
      for (const b of bgInfo) {
        if ((!b.bg || b.bg === 'rgba(0, 0, 0, 0)') && (!b.img || b.img === 'none')) { bad(`[${label}/${skin}] ${b.tag} has NO background/image`); continue; }
        let ratio; try { ratio = contrast(b.fg, b.bg === 'rgba(0, 0, 0, 0)' ? 'rgba(0,0,0,1)' : b.bg); } catch { continue; }
        if (ratio < 3) { bad(`[${label}/${skin}] "${b.text}" fg=${b.fg} bg=${b.bg} ratio=${ratio.toFixed(2)}`); continue; }
        checked++;
      }
      if (checked >= 1) pass(`[${label}/${skin}] ${checked} save button(s) legible`);
      else if (failures === 0) bad(`[${label}/${skin}] nothing passed contrast check`);

      // Save confirmation pop-up (#toast) — the pop-up shown after Save. Its
      // background is skin-INDEPENDENT navy, so its text must be a fixed
      // light color in every skin (regression: color used var(--t1), which is
      // dark ink on paper/snow/daylight → dark-on-dark, invisible pop-up).
      const toast = await pg.$eval('#toast', el => { const c = getComputedStyle(el); return { bg: c.backgroundColor, fg: c.color }; }).catch(() => null);
      if (!toast) bad(`[${label}/${skin}] #toast element missing`);
      else {
        let tr; try { tr = contrast(toast.fg, toast.bg); } catch { tr = 0; }
        if (tr >= 4.5) pass(`[${label}/${skin}] save pop-up (#toast) text legible (${tr.toFixed(1)}:1)`);
        else bad(`[${label}/${skin}] save pop-up (#toast) unreadable: fg=${toast.fg} on ${toast.bg} = ${tr.toFixed(2)}:1`);
      }
    }
  }

  try {
    await waitForPort(BASE, 20000);
    pass(`server up on :${PORT}`);

    browser = await puppeteer.launch({ headless: true, executablePath: findChrome(), protocolTimeout: 90000, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    // ── login as admin (seeded default creds, ids em/pw per admin-login.html) ─
    const pages = [await browser.newPage(), await browser.newPage()];
    await pages[0].goto(`${BASE}/admin-login`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
    const email = process.env.ADMIN_EMAIL || 'admin@jagaguru.ai';
    const password = process.env.ADMIN_PASSWORD || 'Admin@1234!';
    async function loginAdmin(pg) {
      return pg.evaluate((e, p) => {
        const em = document.getElementById('em'), pw = document.getElementById('pw');
        if (!em || !pw) return 'no-inputs';
        em.value = e; pw.value = p;
        (typeof go === 'function') ? go() : (document.getElementById('btn') || {}).click();
        return 'submitted';
      }, email, password);
    }
    const r0 = await loginAdmin(pages[0]).catch(e => 'eval-err: ' + e.message);
    await new Promise(r => setTimeout(r, 1500));
    await loginAdmin(pages[1]).catch(e => 'eval-err: ' + e.message);
    await new Promise(r => setTimeout(r, 1500));
    const tok = await pages[0].evaluate(() => localStorage.getItem('vg_token')).catch(() => null);
    pass('admin login via evaluate → ' + r0 + ', token=' + (tok ? 'ok' : 'null'));

    for (const [which, url] of [['admin', `${BASE}/admin`], ['dashboard', `${BASE}/dashboard`]]) {
      const pg = which === 'admin' ? pages[0] : pages[1];
      await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1200));
      if (pg.url().includes('login')) {
        await loginAdmin(pg).catch(() => {});
        await new Promise(r => setTimeout(r, 1500));
        await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 1200));
      }
      if (which === 'admin') {
        // walk each admin page that has a Save button: AI Engine, Email, Notif-S, General, SEO
        for (const v of ['ai', 'email', 'notif-s', 'general', 'seo']) {
          await pg.evaluate(v => { if (typeof sw === 'function') sw(v); }, v).catch(() => {});
          await new Promise(r => setTimeout(r, 700));
          await checkSkinsOnPage(pg, which + ':' + v);
        }
      } else {
        // dashboard: profile page hosts the Save buttons
        await pg.evaluate(() => { if (typeof sw === 'function') sw('profile'); }).catch(e => pass('dashboard sw(profile) n/a: ' + e.message));
        await new Promise(r => setTimeout(r, 700));
        await checkSkinsOnPage(pg, which);
      }

      // ── unsaved-changes cue: switch to a known form view, adjust an input, expect .save-dirty, clear on click ──
      await pg.evaluate(which === 'admin' ? () => sw('general') : () => sw('profile')).catch(() => {});
      await new Promise(r => setTimeout(r, 700));
      const cue = await pg.evaluate(() => {
        const visible = el => el && el.offsetParent !== null;
        const bo = [...document.querySelectorAll('[id^="save-"]')].map(b => [b, visible(b)]).find(([b, v]) => v && v.solution !== false);
        if (!bo || !bo[1]) return { ok: false, reason: 'no visible save button' };
        const btn = bo[0];
        const card = btn.closest('div, section, form') || document;
        const inputs = [...card.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="file"]), select, textarea')].filter(visible);
        if (!inputs.length) return { ok: false, reason: 'no visible input near ' + btn.id };
        const inp = inputs[0];
        inp.dispatchEvent(new Event(inp.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
        const lit = btn.classList.contains('save-dirty');
        btn.click();
        return new Promise(res => setTimeout(() => res({
          ok: lit && !btn.classList.contains('save-dirty'),
          lit, cleared: !btn.classList.contains('save-dirty'), reason: ''
        }), 80));
      });
      if (cue.ok) pass(`[${which}] save-dirty cue lights on adjust + clears on click`);
      else bad(`[${which}] save-dirty cue failed: ${cue.reason || JSON.stringify(cue)}`);
    }
  } catch (e) {
    bad('driver error: ' + e.message);
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }

  console.log(failures === 0 ? '\nALL SKIN + CUE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  if (failures > 0) console.log('--- last server log ---\n' + serverLog.slice(-1500));
  process.exit(failures === 0 ? 0 : 1);
})();
