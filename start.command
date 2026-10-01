#!/usr/bin/env bash
#
# start.command — one-click VibeFlow: install dependencies, build the Web UI,
# then start VibeFlow and open it in the browser.
#
# Double-click it in Finder, or run it from a terminal. Extra arguments go to
# the vibeflow command, e.g. `./start.command --profile dev`.
#
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "找不到 Node.js，請先安裝 22 以上的版本：https://nodejs.org"
  exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "Node.js 版本太舊（$(node -v)），VibeFlow 需要 22 以上。"
  exit 1
fi

# Reinstall only when the lockfile changed since the last install.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "==> 安裝相依套件"
  npm ci
fi

echo "==> 建置 Web UI"
npm run build:web

echo "==> 啟動 VibeFlow"
exec npm start -- "$@"
