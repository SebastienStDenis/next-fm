#!/usr/bin/env bash
#
# Run the app stack (api, web, temporal, worker) for the CURRENT worktree.
#
# - Picks its own free host ports so it can run alongside the main stack and
#   other worktrees (see the port-override note in README.md).
# - Shares the single Supabase stack rather than starting a per-worktree one;
#   starts the main Supabase instance if nothing is listening yet.
# - Copies .env from the main checkout when the worktree doesn't have one.
# - Opens the web app and Mailpit in a new browser window when it's up.
#
# Usage: scripts/run-local.sh            # start (or reopen) this worktree's stack
#        scripts/run-local.sh --down     # tear this worktree's stack down
set -euo pipefail

MAILPIT_PORT=54324
SUPABASE_API_PORT=54321

log()  { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

command -v docker >/dev/null || die "docker not found on PATH"
docker info >/dev/null 2>&1 || die "docker daemon is not running - start Docker Desktop first"

WORKTREE_ROOT="$(git rev-parse --show-toplevel)" || die "not inside a git repository"
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
cd "$WORKTREE_ROOT"

# A stable, compose-safe project name per worktree so re-runs reuse containers.
BRANCH="$(git branch --show-current 2>/dev/null || true)"
[ -n "$BRANCH" ] || BRANCH="$(basename "$WORKTREE_ROOT")"
PROJECT="nextfm-$(printf '%s' "$BRANCH" | tr '[:upper:]/' '[:lower:]-' | tr -cd 'a-z0-9_-')"

if [ "${1:-}" = "--down" ]; then
  log "Tearing down $PROJECT"
  docker compose -p "$PROJECT" down
  exit 0
fi

# --- .env: fall back to the main checkout ---------------------------------
if [ ! -f "$WORKTREE_ROOT/.env" ]; then
  [ -f "$MAIN_ROOT/.env" ] || die "no .env in this worktree or in $MAIN_ROOT - run 'cp .env.example .env' there first"
  log "Copying .env from $MAIN_ROOT"
  cp "$MAIN_ROOT/.env" "$WORKTREE_ROOT/.env"
fi

# --- Supabase: use the shared instance, start it if it's down -------------
if port_open "$SUPABASE_API_PORT"; then
  log "Supabase already running (shared)"
else
  command -v supabase >/dev/null || die "Supabase isn't running and the supabase CLI isn't installed"
  log "Starting the shared Supabase stack from $MAIN_ROOT"
  (cd "$MAIN_ROOT" && supabase start)
fi

# --- Ports: reuse a running stack's, otherwise find free ones -------------
compose_port() { docker compose -p "$PROJECT" port "$1" "$2" 2>/dev/null | awk -F: 'NF>1{print $NF}' || true; }

API_PORT="$(compose_port api 8000)"
if [ -n "$API_PORT" ]; then
  WEB_PORT="$(compose_port web 3000)"
  TEMPORAL_PORT="$(compose_port temporal 7233)"
  TEMPORAL_UI_PORT="$(compose_port temporal 8233)"
  log "Reusing running stack's ports"
else
  read -r API_PORT WEB_PORT TEMPORAL_PORT TEMPORAL_UI_PORT < <(python3 - <<'PY'
import socket
socks = [socket.socket() for _ in range(4)]
for s in socks:
    s.bind(("127.0.0.1", 0))
print(*[s.getsockname()[1] for s in socks])
for s in socks:
    s.close()
PY
)
  log "Allocated free ports"
fi

WEB_URL="http://localhost:$WEB_PORT"
API_URL="http://localhost:$API_PORT"
MAILPIT_URL="http://localhost:$MAILPIT_PORT"

log "Bringing up '$PROJECT' (api:$API_PORT web:$WEB_PORT temporal:$TEMPORAL_PORT ui:$TEMPORAL_UI_PORT)"
API_PORT="$API_PORT" WEB_PORT="$WEB_PORT" \
TEMPORAL_PORT="$TEMPORAL_PORT" TEMPORAL_UI_PORT="$TEMPORAL_UI_PORT" \
  docker compose -p "$PROJECT" up -d --build

# --- Wait for the web server, then open the browser -----------------------
log "Waiting for the web app on $WEB_URL"
for _ in $(seq 1 90); do
  port_open "$WEB_PORT" && break
  sleep 1
done
port_open "$WEB_PORT" || warn "web app didn't come up in time; opening the tab anyway"

log "Opening web + Mailpit in a new window"
osascript >/dev/null 2>&1 <<OSA || open "$WEB_URL" "$MAILPIT_URL"
tell application "Google Chrome"
  activate
  set w to make new window
  set URL of active tab of w to "$WEB_URL"
  tell w to make new tab with properties {URL:"$MAILPIT_URL"}
end tell
OSA

cat <<SUMMARY

  Stack '$PROJECT' is up:
    web       $WEB_URL
    api       $API_URL  ($API_URL/docs)
    temporal  ui http://localhost:$TEMPORAL_UI_PORT
    mailpit   $MAILPIT_URL   (shared)

  Logs: docker compose -p $PROJECT logs -f
  Stop: scripts/run-local.sh --down
SUMMARY
