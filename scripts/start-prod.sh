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
if ! grep -qE '^APP_URL=https?://' .env 2>/dev/null; then
  echo "⚠️  APP_URL not set — affiliate links, posters, QR codes and payment callbacks will use localhost. Set APP_URL=https://yourdomain.com"
fi

# 2b. .env permissions — it holds every secret; block other users on the host.
if [ -f .env ]; then
  CUR_PERM=$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env 2>/dev/null)
  if [ -n "$CUR_PERM" ] && [ "$CUR_PERM" != "600" ]; then
    chmod 600 .env && echo "🔒 .env permissions tightened to 600 (was $CUR_PERM)"
  fi
fi

# 2c. DB location — must be inside the app root or it will be lost on redeploys.
if grep -qE '^DB_PATH=/' .env 2>/dev/null; then
  echo "ℹ️  DB_PATH is absolute — make sure it points at persistent storage (app root survives redeploys; /tmp does not)."
fi
if ! grep -qE '^(PAYSTACK|FLUTTERWAVE|STRIPE|OPAY|PAYONEER)_SECRET' .env 2>/dev/null; then
  echo "ℹ️  No payment keys in .env — configure gateways in Admin → Payment Gateways (or add PAYSTACK_SECRET_KEY etc. here)."
fi

# 3. data/ directory writable?
mkdir -p data
if ! touch data/.write-test 2>/dev/null; then
  echo "❌ data/ is not writable — check folder permissions (755, owned by your cPanel user)."
  exit 1
fi
rm -f data/.write-test

echo "" 
echo "📅 Recommended cPanel cron jobs (replace YOUR_SECRET and yourdomain.com):"
echo "   Schedulers: */10 * * * * curl -s \"https://yourdomain.com/api/cron/tick?key=YOUR_SECRET\" > /dev/null"
echo "   Nightly DB backup: 30 3 * * * curl -s \"https://yourdomain.com/api/cron/backup?key=YOUR_SECRET\" -o ~/backups/japaquest-\$(date +\\%Y\\%m\\%d).db  (mkdir -p ~/backups first)"
echo ""

# 4. Start
exec node server.js
