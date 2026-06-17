#!/usr/bin/env bash
#
# rebuild.sh — clean rebuild of the VibeFlow packaged app.
#
#   ./rebuild.sh             FAST: build only dist/mac-arm64/VibeFlow.app (no dmg/zip),
#                            and keep renderer/.next so Next.js builds incrementally
#   ./rebuild.sh --release   FULL: clean everything + build dmg/zip with max compression
#                            (what CI publishes; only needed when you want the installers)
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
RELEASE=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=true ;;
    --install) INSTALL=true ;;
    --relaunch) INSTALL=true; RELAUNCH=true ;;
    --release) RELEASE=true ;;
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

if [[ "$RELEASE" == true ]]; then
  echo "==> Cleaning stale build artifacts (app/ renderer/.next dist/)"
  rm -rf app renderer/.next dist
  echo "==> Building installers (nextron build: dmg + zip, max compression)"
  npm run build
  echo "==> Artifacts:"
  ls -lh dist/*.dmg dist/*.zip 2>/dev/null || true
else
  # Fast path: only produce the unpacked .app — skip dmg/zip + maximum
  # compression (the slow part). nextron itself only clears app/ + dist/, so
  # renderer/.next survives and Next.js rebuilds incrementally.
  #   1. nextron --no-pack: build renderer + main into app/, no packaging.
  #   2. electron-builder --mac dir: package app/ into just the .app, no
  #      compression (store), reading the rest from electron-builder.yml.
  echo "==> Building renderer + main (nextron --no-pack, keeps renderer/.next)"
  npx nextron build --no-pack
  echo "==> Packaging .app only (electron-builder --mac dir, no compression)"
  npx electron-builder --mac dir --arm64 -c.compression=store
  echo "==> Built: $BUILT_APP"
fi

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
