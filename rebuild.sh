#!/usr/bin/env bash
#
# rebuild.sh — clean rebuild of the VibeFlow packaged app.
#
#   ./rebuild.sh             clean stale artifacts, then `npm run build`
#   ./rebuild.sh --check     also launch the packaged .app for ~5s to confirm it boots
#   ./rebuild.sh --install   also install the new build over the running / installed
#                            VibeFlow.app (the running app then shows a "立即重啟" banner)
#   ./rebuild.sh --relaunch  --install, then quit the running app and reopen the new build
#
set -euo pipefail

cd "$(dirname "$0")"

CHECK=false
INSTALL=false
RELAUNCH=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=true ;;
    --install) INSTALL=true ;;
    --relaunch) INSTALL=true; RELAUNCH=true ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

BUILT_APP="dist/mac-arm64/VibeFlow.app"

# Resolve where the new build should be installed: prefer the bundle the
# currently-running instance was launched from, else /Applications.
resolve_install_target() {
  local running
  running=$(pgrep -fl "VibeFlow.app/Contents/MacOS/VibeFlow" 2>/dev/null \
    | sed -n 's|^[0-9]* \(.*VibeFlow\.app\)/Contents/MacOS/.*|\1|p' | head -1 || true)
  if [[ -n "$running" ]]; then
    echo "$running"
  elif [[ -d "/Applications/VibeFlow.app" ]]; then
    echo "/Applications/VibeFlow.app"
  fi
}

echo "==> Cleaning stale build artifacts (app/ renderer/.next dist/)"
rm -rf app renderer/.next dist

echo "==> Building (nextron build)"
npm run build

echo "==> Artifacts:"
ls -lh dist/*.dmg dist/*.zip 2>/dev/null || true

if [[ "$INSTALL" == true ]]; then
  TARGET=$(resolve_install_target)
  ABS_BUILT="$(pwd)/$BUILT_APP"
  if [[ -z "$TARGET" ]]; then
    echo "==> Install: no running instance and no /Applications/VibeFlow.app — skipping (use dist/ directly)"
  elif [[ "$TARGET" == "$ABS_BUILT" ]]; then
    echo "==> Install: running instance uses $BUILT_APP — already updated by the build"
  else
    echo "==> Installing new build over $TARGET"
    # Stage next to the target, then swap — the running app keeps its open
    # inodes; its update watcher sees the new app.asar and offers a restart.
    rm -rf "$TARGET.new" "$TARGET.old"
    ditto "$BUILT_APP" "$TARGET.new"
    mv "$TARGET" "$TARGET.old"
    mv "$TARGET.new" "$TARGET"
    rm -rf "$TARGET.old"
    echo "    installed"
  fi
fi

if [[ "$RELAUNCH" == true ]]; then
  TARGET=$(resolve_install_target)
  if [[ -z "$TARGET" ]]; then TARGET="$BUILT_APP"; fi
  if pgrep -f "VibeFlow.app/Contents/MacOS/VibeFlow" >/dev/null; then
    echo "==> Quitting running VibeFlow"
    osascript -e 'quit app "VibeFlow"' 2>/dev/null || true
    for _ in $(seq 1 10); do
      pgrep -f "VibeFlow.app/Contents/MacOS/VibeFlow" >/dev/null || break
      sleep 1
    done
    pkill -f "VibeFlow.app/Contents/MacOS/VibeFlow" 2>/dev/null || true
  fi
  echo "==> Relaunching $TARGET"
  open "$TARGET"
fi

if [[ "$CHECK" == true ]]; then
  APP="$BUILT_APP"
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
