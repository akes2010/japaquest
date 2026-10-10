#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# scripts/watch-payments.sh — poll /api/health for the first live payment
#
#   bash scripts/watch-payments.sh                    # poll localhost until first payment
#   BASE=https://japaquest.com bash scripts/watch-payments.sh
#   bash scripts/watch-payments.sh --once            # single check (cron-friendly)
#
# Watches the payments row count reported by /api/health — no admin credentials
# needed. When the count rises above the last-seen value it prints and ( joys)
# the payment details from the ledger… actually just reports the count change
# and the health snapshot; details live in Admin → Payment Gateways →
# Manual payment confirmations and Admin → Finance Ledger.
#
# State file: last seen count in data/.payments-watcher-state (gitignored —
# data/ already is). In --once mode it exits 0 with no output when nothing
# changed, so a cron line like:
#   */5 * * * * BASE=https://yourdomain.com bash ~/apps/japaquest/scripts/watch-payments.sh --once >> ~/payments-watch.log 2>&1
# only appends on new payments.
# ══════════════════════════════════════════════════════════════════════════
set -u

cd "$(dirname "$0")/.."

ONCE=0
[ "${1:-}" = "--once" ] && ONCE=1

if [ -f ".env" ]; then
  while IFS='=' read -r k v; do
    case "$k" in
      APP_URL) BASE="${BASE:-$v}" ;;
      PORT)    BASE="${BASE:-http://localhost:$v}" ;;
    esac
  done < .env
fi
BASE="${BASE:-http://localhost:${PORT:-4001}}"
STATE_FILE="data/.payments-watcher-state"
INTERVAL="${INTERVAL:-60}"

read_count() {
  curl -s --max-time 15 "$BASE/api/health" \
    | sed -n 's/.*"payments":\([0-9]*\).*/\1/p'
}

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

check_once() {
  local count health
  health=$(curl -s --max-time 15 "$BASE/api/health")
  count=$(echo "$health" | sed -n 's/.*"payments":\([0-9]*\).*/\1/p')
  if [ -z "$count" ]; then
    echo "[$(stamp)] ⚠️  could not read payments count from $BASE/api/health"
    return 2
  fi
  if [ ! -f "$STATE_FILE" ]; then mkdir -p "$(dirname "$STATE_FILE")"; echo "$count" > "$STATE_FILE"; return 0; fi
  local last
  last=$(cat "$STATE_FILE" 2>/dev/null || echo "$count")
  if [ "$count" -gt "$last" ]; then
    echo "[$(stamp)] 💸 NEW LIVE PAYMENT(S): $last → $count total"
    echo "[$(stamp)]     $BASE/api/health → row_counts.payments=$count"
    echo "[$(stamp)]     Details: Admin → Payment Gateways → Manual payments / Admin → Finance Ledger"
    echo "$count" > "$STATE_FILE"
    return 10   # sentinel: something new happened
  fi
  echo "$count" > "$STATE_FILE"
  [ "$ONCE" = 1 ] || echo "[$(stamp)] watching… payments total: $count"
  return 0
}

# First-run baseline
mkdir -p "$(dirname "$STATE_FILE")"
[ -f "$STATE_FILE" ] || { c=$(read_count); [ -n "$c" ] && echo "$c" > "$STATE_FILE"; }

if [ "$ONCE" = 1 ]; then
  check_once
  exit $?
fi

echo "👀 Watching $BASE/api/health for new payments (every ${INTERVAL}s — Ctrl-C to stop)…"
while true; do
  check_once
  rc=$?
  [ $rc -eq 10 ] && echo "🎉  Your first live payment landed!"
  sleep "$INTERVAL"
done
