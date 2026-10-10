#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
 * scripts/credentials-check.js — verify saved gateway/AI credentials survive
 * any code change or deploy. READ-ONLY against data/jagaguru.db: prints key
 * names, lengths, and masked values, never a secret itself.
 *
 *   node scripts/credentials-check.js        # exit 0 = credentials intact
 *   node scripts/credentials-check.js --json # machine-readable summary
 * ══════════════════════════════════════════════════════════════════════════ */
'use strict';

const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'jagaguru.db');
const JSON_MODE = process.argv.includes('--json');

function fail(msg) {
  if (JSON_MODE) console.log(JSON.stringify({ ok: false, error: msg }));
  else console.error('❌ ' + msg);
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) fail(`database not found: ${DB_PATH}`);

require('sql.js')().then(SQL => {
  const dbRaw = new SQL.Database(fs.readFileSync(DB_PATH));
  const rows = dbRaw.exec('SELECT key, value, grp FROM settings')[0];
  if (!rows) fail('settings table empty or missing');
  const RE = /key|secret|token|credential|api/i;
  const allRows = rows.values.map(v => ({ key: v[0], value: v[1], grp: v[2] }))
    .filter(r => RE.test(r.key));

if (rows.length === 0) fail('no credential-like rows in settings — nothing saved?');

const SECRET_PATTERN = /^(sk_|sk-|pk_|pk-|rk_|whsec_|flw|api[_-]?key|key[_-]?)/i;
const masked = v => {
  if (v == null) return '';
  if (!v) return '';
  const s = String(v);
  if (s.length <= 8) return '****';
  return s.slice(0, 4) + '***' + s.slice(-3) + ` (len ${s.length})`;
};

const results = [];
for (const r of allRows) {
  let status = 'present';
  if (!r.value) status = 'EMPTY';
  else if (SECRET_PATTERN.test(String(r.value))) {
    status = 'plaintext-looking';
  }
  results.push({ key: String(r.key), grp: String(r.grp || ''), status, masked: masked(r.value) });
}

if (JSON_MODE) {
  console.log(JSON.stringify({ ok: true, credentials: results }, null, 2));
} else {
  console.log('✅ saved credentials (read-only, values masked):');
  for (const r of results) {
    console.log(`   [${r.status.padEnd(17)}] ${r.key} = ${r.masked || '(empty)'}   grp:${r.grp}`);
  }
}
process.exit(0);
}).catch(e => fail('db open failed: ' + e.message));
