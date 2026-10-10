#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# scripts/smoke.sh — post-deploy smoke test
#
#   bash scripts/smoke.sh                 # against http://localhost:PORT (or APP_URL)
#   BASE=https://japaquest.com bash scripts/smoke.sh
#   bash scripts/smoke.sh --quick         # health + landing only (no credentials needed)
#
# Checks, in order (exit 0 = all passed, 1 = any failed):
#   1. /api/health          status:"ok" + integrity ok
#   2. landing page         200
#   3. admin login          token obtained (credentials from .env or env)
#   4. gateways             ≥1 payment provider configured
#   5. AI                   usable provider pool (test-ai auto)
#   6. settings endpoint    serves payment keys (round-trip of durable-write fix)
#
# Credentials: reads ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_TOKEN from
# environment, else from .env in the app root. ADMIN_TOKEN (a pre-made JWT)
# takes precedence — convenient for cron use.
# ══════════════════════════════════════════════════════════════════════════
set -u

cd "$(dirname "$0")/.."

# ── optional .env credentials/fallbacks ──────────────────────────────────
if [ -f ".env" ]; then
  while IFS='=' read -r k v; do
    case "$k" in
      ADMIN_EMAIL|ADMIN_PASSWORD|ADMIN_TOKEN|APP_URL|PORT)
        v="${v%\"}"; v="${v#\"}"
        case "$k" in
          ADMIN_EMAIL)      [ -z "${ADMIN_EMAIL:-}" ]      && ADMIN_EMAIL="$v" ;;
          ADMIN_PASSWORD)   [ -z "${ADMIN_PASSWORD:-}" ]   && ADMIN_PASSWORD="$v" ;;
          ADMIN_TOKEN)      [ -z "${ADMIN_TOKEN:-}" ]      && ADMIN_TOKEN="$v" ;;
          APP_URL)          BASE="${BASE:-$v}" ;;
          PORT)             BASE="${BASE:-http://localhost:$v}" ;;
        esac ;;
    esac
  done < .env
fi

BASE="${BASE:-http://localhost:${PORT:-4001}}"
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ✅ $*"; }
bad() { fail=$((fail+1)); echo "  ❌ $*"; }

curl_json() { curl -s --max-time 15 "$@"; }

# 1 ── Health + DB integrity
HEALTH=$(curl_json "$BASE/api/health")
case "$HEALTH" in
  *'"status":"ok"'*)        ok "health: ok" ;;
  *)                        bad "health not ok: $(echo "$HEALTH" | head -c 200)" ;;
esac
case "$HEALTH" in
  *'"quick_check":"ok"'*)   ok "db integrity: ok" ;;
  *)                        bad "db integrity not ok" ;;
esac

# 2 ── Landing page serves
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/")
if [ "$CODE" = "200" ]; then ok "landing page: 200"; else bad "landing page: $CODE"; fi

if [ "$QUICK" = 1 ]; then
  echo "── $pass passed, $fail failed (quick mode)"
  [ "$fail" -eq 0 ]
  exit $?
fi

# Login helper (fails soft when no credentials are configured)
if [ -n "${ADMIN_TOKEN:-}" ]; then
  TOKEN="$ADMIN_TOKEN"
else
  TOKEN=""
  if [ -n "${ADMIN_EMAIL:-}" ]; then
    TOKEN=$(curl_json -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
      | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  fi
fi

if [ -z "$TOKEN" ]; then
  echo "  ⚠️  admin credentials not set — skipping admin-only checks ($fail failed so far)"
  echo "     Set ADMIN_EMAIL/ADMIN_PASSWORD (or ADMIN_TOKEN) in .env or environment."
  echo "── $pass passed, $fail failed"
  [ "$fail" -eq 0 ]
  exit $?
fi
ok "admin login: ok"

# 3 ── At least one payment gateway configured
GW=$(curl_json "$BASE/api/admin/payment-gateways" -H "Authorization: Bearer $TOKEN")
CONF=$(node -e '
  let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
    try{ const j=JSON.parse(d);
      console.log((j.providers||[]).filter(p=>p.configured).map(p=>p.key).join(","));
    }catch{}
  })' <<<"$GW")
if [ -n "$CONF" ]; then ok "payment gateways configured: $CONF"; else bad "no payment gateway configured — users cannot pay"; fi

# 4 ── AI pool usable
AI=$(curl_json -X POST "$BASE/api/admin/settings/test-ai" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"model":"auto"}')
case "$AI" in
  *'usable provider'*) ok "AI pool: usable providers available" ;;
  *)                   bad "AI pool not usable: $(echo "$AI" | head -c 150)" ;;
esac

# 5 ── Settings endpoint serves payment keys (round-trip of the durable-write fix)
PST=$(curl_json "$BASE/api/admin/settings/payments" -H "Authorization: Bearer $TOKEN")
case "$PST" in
  *'"paystack_secret_key"'*) ok "payment settings endpoint ok" ;;
  *)                         bad "payment settings endpoint broken" ;;
esac

echo "── $pass passed, $fail failed"
[ "$fail" -eq 0 ]
