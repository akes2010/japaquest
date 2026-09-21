#!/usr/bin/env bash
# ═══════════════════════════
# Production start — used by cPanel "Setup Node.js App" (startup file can be
# this script via `npm run start:prod`, or point cPanel at server.js directly).
#
#   npm run start:prod
#
# Runs in production mode, verifies dependencies and .env, warns (never fails)
# about missing secrets, then execs node server.js.
# ═════════════════════════
set -u
cd "$(dirname "$0")/.."

export NODE_ENV="${NODE_ENV:-production}"

echo "▶️  JapaQuest production start (NODE_ENV=$NODE_ENV)…"

# 1. Dependencies present? (cPanel often runs npm install for you, but be safe)
if [ ! -d node_modules/express ]; then
  echo "📦 node_modules missing — installing production dependencies…"
  npm install --omit=dev --no-audit --no-fund
fi

# 2. .env present and critical secrets set?
if [ ! -f .env ]; then
  echo "⚠️  .env not found — copying .env.example. EDIT IT before going live!"
  cp -n .env.example .env || true
fi
if ! grep -qE '^JWT_SECRET=[0-9a-f]{32,}' .env 2>/dev/null; then
  echo "⚠️  JWT_SECRET missing/weak in .env — generate one:"
  echo "     node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
fi
if ! grep -qE '^CRON_SECRET=[0-9a-f]{16,}' .env 2>/dev/null; then
  echo "ℹ️  CRON_SECRET not set — /api/cron/tick disabled (fine if you don't need cron)."
fi
if ! grep -qE '^(OPENROUTER|GROQ|GEMINI|OPENAI|ANTHROPIC|DEEPSEEK|TOGETHER|HUGGINGFACE)_API_KEY=' .env 2>/dev/null; then
  echo "⚠️  No AI provider key found in .env — AI chat will be unavailable."
fi

# 3. data/ directory writable?
mkdir -p data
if ! touch data/.write-test 2>/dev/null; then
  echo "❌ data/ is not writable — check folder permissions (755, owned by your cPanel user)."
  exit 1
fi
rm -f data/.write-test

# 4. Start
exec node server.js
