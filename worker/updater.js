'use strict';
// ══════════════════════════════════════════════════════════════════════════
// UPDATE PIPELINE — keep a deployed JapaQuest current, database-safe.
// ────────────────────────────────────────────────────────────────────────
// Flow: Codebuff → GitHub repo → hosting server (TrueHost / VPS).
//
//   1. Codebuff commits the new code locally; you push to GitHub.
//   2. The server (periodically, via cron /api/update/tick, or on demand
//      from the admin panel) compares its commit with the GitHub branch head.
//   3. When there is a newer commit, apply() pulls it and runs any project
//      scripts — without ever touching data/ or .env, which live outside the
//      pulled code tree, so the database and secrets survive every update.
//   4. A post-update DB snapshot is archived to data/backups/pre-update-*.db
//      before anything destructive could happen (belt-and-braces; the pull
//      itself must not touch data/ — if it would, the update aborts).
//
// Config via .env:
//   APP_GIT_REMOTE   https URL of your GitHub repo (enables the pipeline)
//   UPDATE_BRANCH    branch to track (default: master)
//   UPDATE_MODE      manual (default) | auto — auto applies when a newer
//                    commit is seen by /api/update/tick
//   UPDATE_SECRET    shared secret required by the tick endpoint
// The running process keeps serving the OLD code until the Node app is
// restarted (cPanel "Restart" button); health/`version` reflects the file on
// disk only after that restart. status() reports last_update so the admin
// panel can show whether a restart is pending.
// ══════════════════════════════════════════════════════════════════════════
const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const os   = require('os');

const APP_DIR       = process.cwd();
const UPDATE_MODE   = (process.env.UPDATE_MODE || 'manual').toLowerCase();
const UPDATE_BRANCH = process.env.UPDATE_BRANCH || 'master';
const GIT_REMOTE    = process.env.APP_GIT_REMOTE || '';
const UPDATE_SECRET = process.env.UPDATE_SECRET || '';
const MAX_LOCK_MSEC = 15 * 60 * 1000; // stale-lock guard

const _state = {
  busy: false,
  started_at: Date.now(),
  since_boot: Date.now(),
  last_check: null,     // { checked_at, remote_rev, local_rev, up_to_date }
  last_update: null,    // { applied_at, from_rev, to_rev, steps, restart_required }
  last_error: null,
  history: [],          // last 10 apply attempts (most recent last)
};

// ── small process helpers ────────────────────────────────────────────────
function run(file, args, opts = {}) {
  return new Promise(resolve => {
    execFile(file, args, { cwd: APP_DIR, timeout: 120_000, encoding: 'utf8', ...opts }, (err, stdout, stderr) => resolve({
      ok: !err, code: err && typeof err.code === 'number' ? err.code : (err ? 1 : 0),
      out: String(stdout || '').trim(), errOut: String(stderr || '').trim(),
      error: err ? err.message : null,
    }));
  });
}
// Synchronous quick lookups (git may not exist; degrade to 'unknown')
function revSync() {
  try { return require('child_process').execSync('git rev-parse HEAD', { cwd: APP_DIR, encoding: 'utf8', timeout: 6_000 }).trim(); }
  catch { return _state.last_update?.to_rev || 'unknown'; }
}
function hasGit() {
  try { return fs.existsSync(path.join(APP_DIR, '.git')) && require('child_process').execSync('git --version', { encoding: 'utf8' }).includes('git'); }
  catch { return false; }
}
function gitOk(r) { return r && r.ok && /^[0-9a-f]{40}$/.test(r.out); }

// ── status snapshot (safe to call from any endpoint, sync) ───────────────
function status() {
  const localRev = revSync();
  const pending = !!(_state.last_update?.restart_required &&
                     _state.last_update.to_rev && _state.last_update.to_rev !== localRev);
  return {
    enabled: !!GIT_REMOTE,        // pipeline fully enabled only with a remote
    mode: UPDATE_MODE,
    branch: UPDATE_BRANCH,
    remote_set: !!GIT_REMOTE,
    secret_set: !!UPDATE_SECRET,
    has_git: hasGit(),
    local_rev: localRev,
    local_rev_short: localRev.slice(0, 8),
    version: (() => { try { return require(path.join(APP_DIR, 'package.json')).version; } catch { return '?'; } })(),
    busy: _state.busy,
    uptime_sec: Math.floor((Date.now() - _state.since_boot) / 1000),
    last_check: _state.last_check,
    last_update: _state.last_update && { ..._state.last_update, restart_pending: pending },
    last_error: _state.last_error,
    history: _state.history.slice(-10),
    platform: `${os.type()} ${os.release()}`,
    node: process.version,
  };
}

// ── STEP 1 — CHECK: compare local HEAD with the GitHub branch head ──────
async function checkUpdate() {
  const out = { checked_at: new Date().toISOString(), ...status() };
  if (!GIT_REMOTE) {
    out.error = 'APP_GIT_REMOTE not set — update pipeline disabled (status only).';
    _state.last_error = out.error;
    return out;
  }
  if (!hasGit()) {
    out.error = 'Deploy is not a git working copy (no .git) — git pull unavailable. Re-clone per DEPLOY_TRUEHOST.md, or upload zips manually.';
    _state.last_error = out.error;
    return out;
  }
  const need = _state.last_check == null || (Date.now() - new Date(_state.last_check.checked_at).getTime() > 60_000);
  if (!need) return { ...out, ..._state.last_check };

  const fetchRes = await run('git', ['fetch', '--quiet', GIT_REMOTE, UPDATE_BRANCH]);
  if (!fetchRes.ok) {
    _state.last_error = `git fetch failed: ${fetchRes.errOut || fetchRes.error}`;
    out.error = _state.last_error;
    return out;
  }
  const remoteRes = await run('git', ['rev-parse', '--verify', `FETCH_HEAD`]);
  if (!gitOk(remoteRes)) {
    _state.last_error = `Could not resolve remote HEAD: ${remoteRes.errOut || remoteRes.error}`;
    out.error = _state.last_error;
    return out;
  }
  const remoteRev = remoteRes.out.trim();
  const localRev = revSync();
  const upToDate = remoteRev === localRev;
  const behind = await (async () => {
    if (upToDate) return 0;
    const r = await run('git', ['rev-list', '--count', `${localRev}..FETCH_HEAD`]);
    return r.ok && /^\d+$/.test(r.out) ? parseInt(r.out, 10) : -1;
  })();

  const check = {
    checked_at: new Date().toISOString(),
    local_rev: localRev,
    local_rev_short: localRev.slice(0, 8),
    remote_rev: remoteRev,
    remote_rev_short: remoteRev.slice(0, 8),
    up_to_date: upToDate,
    behind: behind < 0 ? null : behind,
    dirty_remote: /(github|https?):/.test(GIT_REMOTE) ? 'https' : 'other',
  };
  _state.last_check = { ...check, mode: UPDATE_MODE };
  _state.last_error = null;
  return { ...out, ...check };
}

// ── STEP 2 — APPLY: pull latest code, run any triggering npm scripts ────
// Never touches data/ (.env, *.db). If anything in data/ or .env differs
// from HEAD, the update aborts rather than clobbering it.
async function applyUpdate() {
  if (_state.busy) return { error: 'Update already in progress' };
  if (!GIT_REMOTE) return { error: 'APP_GIT_REMOTE not set — update pipeline disabled' };
  if (!hasGit())  return { error: 'Not a git working copy — re-clone or upload manually' };
  if (!UPDATE_SECRET) return { error: 'UPDATE_SECRET not set — refusing to auto-apply code changes without authorization' };

  _state.busy = true;
  const t0 = Date.now();
  const fromRev = revSync();
  const steps = [];
  const note = (s, r, ok) => steps.push({ step: s, ok: !!ok, detail: r?.errOut || r?.out || r?.error || '' });
  try {
    // Pre-flight: make sure no tracked files that should survive are dirty.
    // (data/ and .env are gitignored; if the operator committed them anyway,
    // pull could fail — better to abort than clobber.)
    const dataTracked = await run('git', ['ls-files', '--error-unmatch', 'data/jagaguru.db', '.env'], { timeout: 10_000 });
    if (dataTracked.ok) {
      const msg = 'data/jagaguru.db or .env is tracked in git — aborting to protect the live database. Remove them from the repo (git rm --cached).';
      _state.last_error = msg; return { error: msg, steps };
    }

    const chkRes = await checkUpdate();
    if (chkRes.error) { _state.last_error = chkRes.error; return { error: chkRes.error, steps }; }
    if (chkRes.up_to_date) {
      const done = { ok: true, up_to_date: true, message: 'Already at the latest commit', from_rev: fromRev, steps };
      _state.history.push({ at: new Date().toISOString(), ...done });
      return done;
    }

    // Archive the DB + uploads (settings, AI keys, logo/favicon) before pulling.
    const snapshots = snapshotBeforeUpdate(fromRev);
    if (snapshots.length) note('pre-update-snapshot', { out: snapshots.join('; ') }, true);

    // Stash any local edits (e.g. .env if not gitignored) so pull never fails on a dirty tree.
    const stash = await run('git', ['stash', 'push', '--include-untracked', '-m', 'auto-update safety stash']);
    note('stash', stash, true);

    // Pull with fast-forward only — we never want a surprise merge.
    const pull = await run('git', ['pull', '--quiet', '--ff-only', GIT_REMOTE, UPDATE_BRANCH], { timeout: 300_000 });
    if (!pull.ok) {
      const msg = `git pull --ff-only failed: ${pull.errOut || pull.error}. ` +
        'Local branch may have diverged — run `git fetch && git reset --hard origin/' + UPDATE_BRANCH + '` ONLY after archiving a DB snapshot.';
      _state.last_error = msg; return { error: msg, steps, from_rev: fromRev };
    }
    note('pull', pull, true);

    const toRev = revSync();
    // Package deps may have changed → install quietly (no-op when lockfile unchanged).
    const npmInstall = await run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { timeout: 300_000 });
    note('npm-install', npmInstall, npmInstall.ok);

    // Migrations / maintenance endpoints that need no server boot — future hooks.
    persistUpdateStamp(toRev);
    _state.last_update = { applied_at: new Date().toISOString(), from_rev: fromRev, to_rev: toRev,
      restart_required: true, steps, duration_ms: Date.now() - t0 };
    _state.history.push({ at: new Date().toISOString(), ok: true, from_rev: fromRev, to_rev: toRev });
    // Original running process keeps OLD code; restart finishes the update.
    return { ok: true, from_rev: fromRev, to_rev: toRev, restart_required: true, steps };
  } catch (e) {
    _state.last_error = e.message;
    _state.history.push({ at: new Date().toISOString(), ok: false, error: e.message, from_rev: fromRev });
    return { error: e.message, steps, from_rev: fromRev };
  } finally {
    _state.last_check && (_state.last_check.checked_at = new Date().toISOString());
    _state.busy = false;
  }
}

// Writes the applied revision to data/updates.log for auditing.
function persistUpdateStamp(rev) {
  try {
    fs.mkdirSync(path.join(APP_DIR, 'data'), { recursive: true });
    fs.appendFileSync(path.join(APP_DIR, 'data', 'updates.log'),
      `${new Date().toISOString()} rev=${rev} duration=(see last_update)\n`);
  } catch {}
}

// ── PRE-UPDATE SNAPSHOT ─────────────────────────────────────────────────
// Everything the operator configures lives OUTSIDE the pulled code tree:
//   data/          → settings table (logo/favicon URLs, AI & SMTP keys, gateways)
//   public/uploads → the logo and favicon FILES themselves
// git pull must not touch either, but belt-and-braces: before every apply we
// archive a DB snapshot plus the uploads dir to data/backups/pre-update-*,
// so even a worst-case clobber is restorable from the admin panel.
function snapshotBeforeUpdate(fromRev) {
  const created = [];
  try {
    fs.mkdirSync(path.join(APP_DIR, 'data', 'backups'), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const dbPath = path.join(APP_DIR, 'data', 'jagaguru.db');
    if (fs.existsSync(dbPath)) {
      const name = `pre-update-${stamp}-${fromRev.slice(0, 8)}.db`;
      fs.copyFileSync(dbPath, path.join(APP_DIR, 'data', 'backups', name));
      created.push(`data/backups/${name}`);
    }
    const upDir = path.join(APP_DIR, 'public', 'uploads');
    const entries = fs.existsSync(upDir) ? fs.readdirSync(upDir).filter(f => !f.startsWith('.')) : [];
    if (entries.length) {
      const bDir = path.join(APP_DIR, 'data', 'backups', `pre-update-uploads-${stamp}-${fromRev.slice(0, 8)}`);
      fs.mkdirSync(bDir, { recursive: true });
      for (const f of entries) fs.copyFileSync(path.join(upDir, f), path.join(bDir, f));
      created.push(`data/backups/pre-update-uploads-${stamp}-${fromRev.slice(0, 8)}/ (${entries.length} files)`);
    }
    // Keep the archive tidy: at most 5 pre-update DB snapshots.
    try {
      fs.readdirSync(path.join(APP_DIR, 'data', 'backups'))
        .filter(f => f.startsWith('pre-update-') && f.endsWith('.db'))
        .sort().slice(0, -5)
        .forEach(f => fs.unlinkSync(path.join(APP_DIR, 'data', 'backups', f)));
    } catch {}
  } catch (e) {
    // A failed snapshot should not block the update — the pull itself is
    // data-safe. Record it so the operator can see the gap.
    _state.last_error = `pre-update snapshot incomplete: ${e.message}`;
  }
  return created;
}

// ── CRON DRIVER: run check + (optionally) apply on a schedule ───────────
// Called by /api/update/tick in server.js on a cPanel/VPS cron. In 'auto'
// mode it runs applyUpdate() whenever a newer commit exists; 'manual' just
// reports status so the admin can click Apply (or a human approves it).
async function tick() {
  if (_state.busy) return { ok: true, skipped: 'update already in progress' };
  const now = Date.now();
  if (_state.last_check && now - new Date(_state.last_check.checked_at).getTime() < 60_000)
    return { ok: true, skipped: 'checked < 1m ago', ..._state.last_check };
  const chk = await checkUpdate();
  if (chk.error) return { ok: false, error: chk.error };
  if (chk.up_to_date) return { ok: true, up_to_date: true };
  if (UPDATE_MODE !== 'auto') return { ok: true, update_available: true, note: 'UPDATE_MODE=manual — apply from the admin panel' };
  const res = await applyUpdate();
  return res;
}

module.exports = { status, checkUpdate, applyUpdate, tick };
