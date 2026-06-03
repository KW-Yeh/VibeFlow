#!/usr/bin/env bash
#
# rebuild.sh — clean rebuild of the VibeFlow packaged app.
#
#   ./rebuild.sh          clean stale artifacts, then `npm run build`
#   ./rebuild.sh --check   also launch the packaged .app for ~5s to confirm it boots
#
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Cleaning stale build artifacts (app/ renderer/.next dist/)"
rm -rf app renderer/.next dist

echo "==> Building (nextron build)"
npm run build

echo "==> Artifacts:"
ls -lh dist/*.dmg dist/*.zip 2>/dev/null || true

if [[ "${1:-}" == "--check" ]]; then
  APP="dist/mac-arm64/VibeFlow.app"
  echo "==> Boot-checking $APP"
  open "$APP"
  sleep 5
  if pgrep -fl "VibeFlow.app/Contents/MacOS" >/dev/null; then
    echo "    OK — app launched and is running"
  else
    echo "    WARNING — app did not stay running (possible crash)" >&2
  fi
  osascript -e 'quit app "VibeFlow"' 2>/dev/null || true
  sleep 1
  pkill -f "VibeFlow.app/Contents/MacOS" 2>/dev/null || true
  echo "    closed"
fi

echo "==> Done. See dist/"
