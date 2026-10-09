#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# scripts/update.sh — deploy/refresh this server's code from GitHub.
#
#   bash scripts/update.sh           # one-shot: pull latest + npm install
#   bash scripts/update.sh --check   # just report (exit 0 = up to date, 1 = update available)
#
# Database-safe by design: data/ and .env are never touched (they are
# gitignored). Refuses to run if the DB or .env is somehow tracked in git.
# Safe to run from a cPanel cron while the app is serving traffic — the
# running Node process keeps its in-memory version until it is restarted.
# ══════════════════════════════════════════════════════════════════════════
set -u

cd "$(dirname "$0")/.."

BRANCH="${UPDATE_BRANCH:-master}"
REMOTE="${APP_GIT_REMOTE:-origin}"

fail()  { echo "❌  $*" >&2; exit 2; }
note()  { echo "ℹ️   $*"; }
ok()    { echo "✅  $*"; }

[ -d .git ] || fail "Not a git working copy (no .git) — clone per DEPLOY_TRUEHOST.md or upload files manually."

# 0. Never clobber the database or secrets.
for f in data/jagaguru.db .env; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    fail "$f is tracked in git — update aborted to protect live data. Run: git rm --cached $f && commit."
  fi
done

# 1. Fetch the remote branch head.
git fetch --quiet "$REMOTE" "$BRANCH" || fail "git fetch failed (check APP_GIT_REMOTE / network)."

LOCAL=$(git rev-parse HEAD 2>/dev/null || echo unknown)
REMOTE_REV=$(git rev-parse --verify FETCH_HEAD 2>/dev/null || echo unknown)
[ "$REMOTE_REV" != unknown ] || fail "Could not resolve remote revision."

BEHIND=$(git rev-list --count "$LOCAL..$REMOTE_REV" 2>/dev/null || echo 0)

if [ "${1:-}" = "--check" ]; then
  if [ "$BEHIND" -eq 0 ]; then
    ok "Up to date at ${LOCAL:0:8} ($(date '+%Y-%m-%d %H:%M:%S'))"
    exit 0
  fi
  note "Update available: $BEHIND commit(s) behind remote ($REMOTE_REV)"
  exit 1
fi

if [ "$BEHIND" -eq 0 ]; then
  ok "Already up to date at ${LOCAL:0:8}"
  exit 0
fi

echo "⬇️   Updating: $BEHIND commit(s) behind (${LOCAL:0:8} → ${REMOTE_REV:0:8})…"

# 2. Stash any stray local edits so a pull never bails on a dirty tree.
git stash push --include-untracked -m "auto-update $(date -Iseconds)" >/dev/null 2>&1 || true

# 3. Fast-forward only — never a surprise merge on a live server.
git pull --quiet --ff-only "$REMOTE" "$BRANCH" || {
  fail "git pull --ff-only failed — local branch diverged. After taking a DB snapshot you can align with: git reset --hard $REMOTE_REV"
}

# 4. Sync dependencies (no-op when lockfile unchanged).
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || note "npm install had warnings — check `npm ls` if the app misbehaves."

NEW=$(git rev-parse HEAD)
mkdir -p data
echo "$(date -Iseconds) updated ${LOCAL:0:8} → ${NEW:0:8}" >> data/updates.log
ok "Code updated ${LOCAL:0:8} → ${NEW:0:8}. Restart the Node app (cPanel → Setup Node.js App → Restart, or \`npm run start:prod\`) to serve the new code. Database and .env untouched."
