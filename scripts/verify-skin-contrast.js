#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
/**
 * scripts/verify-skin-contrast.js — permanent skin-contrast QA for both apps.
 *
 * Boots a scratch server, logs in, and for /dashboard + /admin across all 5
 * skins (night · ink · paper · snow · daylight) asserts that the real rendered
 * contrast of the app's control buttons is ≥ 3:1 (measured by clip-screenshot,
 * decoded in Node — pixels, not computed styles, so translucent tints over
 * grain/aurora backdrops are measured as they render).
 *
 * Controls: menu-btn, notif-btn, sb-btn (active + plain), model-pill,
 * dashboard sb-logout, admin nav-group + logout-btn. Emoji-only buttons are
 * skipped (emoji glyphs carry their own fixed multicolor fill, CSS color can
 * not change them). A measurement that comes back physically impossible
 * (ratio < 1.5 for a text-bearing clip = stale frame) is retried once.
 *
 * Needs puppeteer-core reachable (same convention as verify-admin-skins.js).
 * Exit 0 = green, 1 = failures.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');

/* ── minimal PNG decoder (8-bit truecolor + alpha, filter types 0-4) ── */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, w, h, bitDepth, colorType; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('bitDepth ' + bitDepth);
  const channels = { 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('colorType ' + colorType + ' (unsupported)');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(w * h * channels);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += Math.floor((a + b) / 2);
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  function regionStats(x0, y0, rw, rh) {
    let minL = 1, maxL = 0, n = 0;
    for (let y = y0; y < y0 + rh && y < h; y++) for (let x = x0; x < x0 + rw && x < w; x++) {
      const o = (y * w + x) * channels; const a = channels === 4 ? out[o + 3] : 255; if (a < 200) continue;
      const L = .2126 * f(out[o]) + .7152 * f(out[o + 1]) + .0722 * f(out[o + 2]);
      if (L < minL) minL = L; if (L > maxL) maxL = L; n++;
    }
    return { minL, maxL, ratio: (maxL + .05) / (minL + .05), n };
  }
  return { w, h, regionStats };
}

(async () => {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch {
    const alt = '/tmp/verify-env/node_modules/puppeteer-core';
    if (fs.existsSync(alt)) puppeteer = require(alt);
    else { console.error('puppeteer-core not installed — npm i puppeteer-core (dev)'); process.exit(1); }
  }
  function findChrome() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    for (const p of ['/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']) if (fs.existsSync(p)) return p;
    throw new Error('No Chrome found. Set CHROME_PATH=/path/to/chrome');
  }
  const PORT = process.env.VERIFY_PORT || 4394;
  const BASE = 'http://127.0.0.1:' + PORT;
  const SKINS = ['night', 'ink', 'paper', 'snow', 'daylight'];
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
  await pg.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  for (const page of ['/dashboard', '/admin']) {
    for (const skin of SKINS) {
      // Measure a skin into a local buffer and flush ok() only when the whole
      // skin completed — a detached frame (mid-run navigation) or any transient
      // runner error retries that skin once from a fresh goto, so one flaky
      // frame never double-counts or silently signals pass.
      let results = null;
      for (let attempt = 0; attempt < 2 && results === null; attempt++) {
        try {
          await pg.evaluateOnNewDocument((sk, t) => { try { localStorage.setItem('vg_token', t); localStorage.setItem('vg_role', 'admin'); localStorage.setItem('jquest_skin', sk); } catch {} }, skin, tok);
          await pg.goto(BASE + page, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 1500));
          const sk = await pg.evaluate(() => document.body.dataset.skin);
          if (sk !== skin) { results = { rendered: false, real: sk + ' @' + pg.url(), rows: [] }; break; }
          // freeze animations so a stable frame exists for every measurement
          await pg.evaluate(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.appendChild(s); });
          await new Promise(r => setTimeout(r, 400));
          const targets = await pg.evaluate(() => {
            const dash = location.pathname.startsWith('/dashboard');
            const sels = ['.menu-btn', '.notif-btn', '.sb-btn.active', '.sb-btn:not(.active)'];
            if (dash) sels.push('.sb-logout'); else sels.push('.nav-group', '.logout-btn', '.model-pill');
            const out = [];
            for (const sel of sels) {
              const el = document.querySelector(sel);
              if (!el) continue;
              const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
              // control has letters/digits? (emoji-only glyphs have fixed color fill)
              const hasText = /[A-Za-z0-9\u2013\u2014\u2191\u2192\u21a9\u2630]/.test(el.textContent || '');
              // inside a collapsed nav group? (ancestor max-height 0 keeps a rect but paints nothing)
              let clipped = false, node = el;
              while (node && node !== document.body) {
                const anc = getComputedStyle(node);
                if (anc.overflow === 'hidden' && node !== document.getElementById('sb') && node !== document.getElementById('content') && node.scrollHeight === 0) { clipped = true; break; }
                node = node.parentElement;
              }
              if (!hasText || clipped) continue;
              if (r.width < 8 || r.height < 8) continue; // control hidden at this viewport (e.g. desktop ☰)
              out.push({ sel, x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), w: Math.round(r.width), h: Math.round(r.height) });
            }
            return out;
          });
          const rows = [];
          for (const t of targets) {
            let st = null;
            for (let mA = 0; mA < 2; mA++) {
              const buf = await pg.screenshot({ clip: { x: t.x, y: t.y, width: Math.max(1, t.w), height: Math.max(1, t.h) }, timeout: 15000 });
              const stats = decodePNG(buf).regionStats(0, 0, t.w, t.h);
              if (stats.n > 30 && stats.ratio > 1.5) { st = stats; break; } // possible measurement = text pixels present
              st = stats; // retry once on stale-frame (flat) readings
            }
            rows.push({ name: t.sel, good: st.ratio >= 3, ex: st.ratio.toFixed(2) + ':1' });
          }
          results = { rendered: true, rows };
        } catch (e) {
          if (attempt === 1) { results = { rendered: false, real: 'ERR ' + (e.message || String(e)).slice(0, 60), rows: [] };
          } else { await new Promise(r => setTimeout(r, 800)); }
        }
      }
      ok(page + ' ' + skin + ' renders', results.rendered, results.real || '');
      for (const row of results.rows) ok(page + ' ' + skin + ' ' + row.name + ' rendered ≥3:1', row.good, row.ex);
    }
  }

  console.log('\n════ SKIN CONTRAST VERIFY: ' + (fail ? fail + ' FAILED ✗' : 'ALL ' + pass + ' CHECKS PASSED ✅') + ' ════');
  if (fails.length) console.log('Failed: ' + fails.join(' | '));
  await browser.close();
  server.kill('SIGTERM');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message || e); process.exit(1); });
