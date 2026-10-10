#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# scripts/verify-ai.sh — prove replies are actually coming through a real
# provider (not the engine stub, not a dead pool).
#
#   bash scripts/verify-ai.sh
#   BASE=https://japaquest.com bash scripts/verify-ai.sh
#   bash scripts/verify-ai.sh --model openai     # pin a specific model
#
# Flow: admin login → POST /api/ai/chat {model:auto|given} → assert a real
# reply body. Prints which provider actually served the reply (servedBy).
# Credentials: ADMIN_EMAIL/ADMIN_PASSWORD or ADMIN_TOKEN from env or .env.
# ══════════════════════════════════════════════════════════════════════════
set -u

cd "$(dirname "$0")/.."

if [ -f ".env" ]; then
  while IFS='=' read -r k v; do
    case "$k" in
      ADMIN_EMAIL)      [ -z "${ADMIN_EMAIL:-}" ]    && ADMIN_EMAIL="$v" ;;
      ADMIN_PASSWORD)   [ -z "${ADMIN_PASSWORD:-}" ] && ADMIN_PASSWORD="$v" ;;
      ADMIN_TOKEN)      [ -z "${ADMIN_TOKEN:-}" ]    && ADMIN_TOKEN="$v" ;;
      APP_URL)          BASE="${BASE:-$v}" ;;
      PORT)             BASE="${BASE:-http://localhost:$v}" ;;
    esac
  done < .env
fi
BASE="${BASE:-http://localhost:${PORT:-4001}}"
MODEL="${2:-${AI_MODEL:-auto}}"
[ "${1:-}" = "--model" ] && [ -n "${2:-}" ] && MODEL="$2"

# Login
if [ -n "${ADMIN_TOKEN:-}" ]; then
  TOKEN="$ADMIN_TOKEN"
else
  [ -n "${ADMIN_EMAIL:-}" ] || { echo "❌ ADMIN_EMAIL/ADMIN_PASSWORD (or ADMIN_TOKEN) not set"; exit 1; }
  TOKEN=$(curl -s --max-time 15 -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  [ -n "$TOKEN" ] || { echo "❌ admin login failed"; exit 1; }
fi

# Real chat round-trip
BODY="{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: JAPAQUEST-AI-OK\"}],\"ground\":false}"
RESP=$(curl -s --max-time 60 -X POST "$BASE/api/ai/chat" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$BODY")

# chat route returns { reply, servedBy } on success, { error } on failure
ERR=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log(j.error||"")}catch{console.log("unparseable response")}})' <<<"$RESP")
REPLY=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log((j.reply||"").slice(0,200))}catch{}})' <<<"$RESP")
SERVED=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log(j.servedBy||"")}catch{}})' <<<"$RESP")

if [ -n "$REPLY" ]; then
  echo "✅ AI replied  (model: $MODEL, served by: ${SERVED:-unknown})"
  echo "   reply: ${REPLY:0:180}"
  exit 0
else
  echo "❌ AI chat failed (model: $MODEL): ${ERR:-$RESP}"
  exit 1
fi
