@echo off
rem start.cmd - one-click VibeFlow on Windows: install dependencies, build the
rem Web UI, then start VibeFlow and open it in the browser.
rem
rem Double-click it in Explorer, or run it from a terminal. Extra arguments go
rem to the vibeflow command, e.g. `start.cmd --profile dev`.
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install version 22 or later: https://nodejs.org
  goto fail
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)"
if errorlevel 1 (
  echo Node.js is too old. VibeFlow needs version 22 or later.
  goto fail
)

rem Reinstall only when the lockfile changed since the last install.
node -e "const fs=require('fs');const lock='node_modules/.package-lock.json';process.exit(!fs.existsSync(lock)||fs.statSync('package-lock.json').mtimeMs>fs.statSync(lock).mtimeMs?1:0)"
if errorlevel 1 (
  echo ==^> Installing dependencies
  call npm ci
  if errorlevel 1 goto fail
)

echo ==^> Building the Web UI
call npm run build:web
if errorlevel 1 goto fail

echo ==^> Starting VibeFlow
call npm start -- %*
if errorlevel 1 goto fail
exit /b 0

:fail
echo.
echo VibeFlow stopped with an error. See the messages above.
rem Keep a double-clicked window open long enough to read why.
pause
exit /b 1
