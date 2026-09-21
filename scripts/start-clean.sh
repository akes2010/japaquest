#!/usr/bin/env bash
# Auto-clean start: kills any stale instance of THIS project's server on the
# port, then starts a fresh one. Never touches unrelated processes.
#
#   npm run start:clean            (port from .env / PORT / default 4001)
#   PORT=4002 npm run start:clean
set -u

PORT="${PORT:-$([ -f .env ] && grep -E '^PORT=' .env | cut -d= -f2 | tr -d '[:space:]')}"
PORT="${PORT:-4001}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Only kill a process if it is actually this project's server.js — never a
# blind kill by port (that could take down an unrelated app).
killed=0
for pid in $(lsof -ti tcp:"$PORT" 2>/dev/null); do
  if tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "server.js"; then
    # Confirm the process' cwd is this project
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
    if [ "$cwd" = "$PROJECT_DIR" ]; then
      echo "🔄 Killing stale server pid $pid (port $PORT)…"
      kill "$pid" 2>/dev/null
      killed=1
    fi
  fi
done
if [ "$killed" = "1" ]; then
  # Wait for the port to actually free up (up to 5s)
  for _ in 1 2 3 4 5; do
    lsof -ti tcp:"$PORT" > /dev/null 2>&1 || break
    sleep 1
  done
fi

echo "▶️  Starting JapaGuru on port $PORT…"
cd "$PROJECT_DIR"
exec node server.js
