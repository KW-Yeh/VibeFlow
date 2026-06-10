#!/usr/bin/env bash
#
# rebuild.command — Finder-double-clickable VibeFlow installer.
#
# Double-click in Finder: opens Terminal, builds the latest VibeFlow, installs
# it over the running/installed VibeFlow.app, and relaunches it. The window
# stays open at the end so you can read the result.
#
set -euo pipefail

cd "$(dirname "$0")"

clear
cat <<'BANNER'
╭───────────────────────────────────────────────╮
│                                                 │
│              VibeFlow  Installer                │
│                                                 │
│      Build · Install · Relaunch                 │
│                                                 │
╰───────────────────────────────────────────────╯
BANNER
echo
echo "This will build the latest version of VibeFlow and install it"
echo "on this Mac, then reopen the app. It may take a few minutes."
echo

./rebuild.sh --relaunch

echo
echo "✅  VibeFlow has been installed and relaunched."
echo
echo "    You can close this window. Press any key to close."
read -r -n 1 -s
