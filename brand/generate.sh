#!/usr/bin/env bash
# Regenerates the bot-account avatars from avatar.html. Needs Google Chrome.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
size="${1:-1024}"

shoot() {
  local out="$1" query="$2"
  local profile
  profile="$(mktemp -d)"
  rm -f "$out"
  "$chrome" \
    --headless \
    --disable-gpu \
    --allow-file-access-from-files \
    --user-data-dir="$profile" \
    --no-first-run \
    --no-default-browser-check \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --window-size="$size,$size" \
    --virtual-time-budget=8000 \
    --screenshot="$out" \
    "file://$here/avatar.html?$query&size=$size" >/dev/null 2>&1 &
  # Chrome's updater keeps the process alive well past the screenshot, so wait
  # on the file rather than on exit.
  local pid=$!
  for _ in $(seq 1 25); do
    [ -s "$out" ] && sleep 1 && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  rm -rf "$profile"
  [ -s "$out" ] || { echo "failed: $out" >&2; return 1; }
  echo "wrote $(basename "$out")"
}

for mode in light dark; do
  for art in grille wave; do
    shoot "$here/nextfm-$art-$mode.png" "mode=$mode&art=$art" || exit 1
  done
done
