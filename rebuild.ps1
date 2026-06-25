#Requires -Version 5.1
<#
.SYNOPSIS
    rebuild.ps1 — clean rebuild of the VibeFlow packaged app on Windows.

.DESCRIPTION
    .\rebuild.ps1             FAST: build only dist\win-unpacked\ (no installer),
                              keep renderer\.next so Next.js builds incrementally
    .\rebuild.ps1 --release   FULL: clean everything + build NSIS installer
                              (what CI publishes; only needed when you want the installer)
    .\rebuild.ps1 --check     also launch the unpacked exe for ~5s to confirm it boots
    .\rebuild.ps1 --relaunch  quit any running VibeFlow, rebuild, then relaunch from
                              dist\win-unpacked\VibeFlow.exe
#>

param(
    [switch]$release,
    [switch]$check,
    [switch]$relaunch
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# electron-builder always downloads winCodeSign (used for ASAR integrity via rcedit,
# not just signing).  Its archive contains macOS dylib symlinks that 7-Zip can't
# create on Windows without Developer Mode — exit code 2 → retry loop forever.
# Fix: pre-populate the cache ourselves using 7-Zip WITHOUT the -snl (symlink)
# flag so the macOS entries are silently skipped.  Once the cache dir exists,
# electron-builder skips the download entirely.
function Ensure-WinCodeSign {
    $version  = "winCodeSign-2.6.0"
    $cacheDir = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign\$version"
    if (Test-Path $cacheDir) { return }

    Write-Host "==> Pre-caching $version (skipping macOS symlinks)..."
    $tmpArchive = "$env:TEMP\$version.7z"
    Invoke-WebRequest `
        -Uri "https://github.com/electron-userland/electron-builder-binaries/releases/download/$version/$version.7z" `
        -OutFile $tmpArchive -UseBasicParsing
    New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
    # Extract without -snl so macOS symlink entries are skipped, not created.
    $sevenZip = Join-Path $PSScriptRoot "node_modules\7zip-bin\win\x64\7za.exe"
    & $sevenZip x $tmpArchive "-o$cacheDir" "-bd" "-y" | Out-Null
    Remove-Item $tmpArchive -ErrorAction SilentlyContinue
    Write-Host "    Cached to: $cacheDir"
}

$env:WIN_CSC_LINK = ""
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

$BUILT_EXE = "dist\win-unpacked\VibeFlow.exe"

function Stop-VibeFlow {
    $procs = Get-Process -Name "VibeFlow" -ErrorAction SilentlyContinue
    if ($procs) {
        Write-Host "==> Stopping running VibeFlow process(es)"
        $procs | Stop-Process -Force
        Start-Sleep -Seconds 2
    }
}

Ensure-WinCodeSign

if ($release) {
    Write-Host "==> Cleaning stale build artifacts (app\ renderer\.next dist\)"
    foreach ($dir in @("app", "renderer\.next", "dist")) {
        if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    }
    Write-Host "==> Building NSIS installer (nextron build)"
    npm run build
    Write-Host "==> Artifacts:"
    Get-ChildItem dist\*.exe -ErrorAction SilentlyContinue | Format-Table Name, Length
} else {
    # Fast path: unpacked dir only — no installer, no compression.
    #   1. nextron --no-pack: build renderer + main into app/, no packaging.
    #   2. electron-builder --win dir: package app/ into dist\win-unpacked\ only,
    #      no compression, reading the rest from electron-builder.yml.
    Write-Host "==> Building renderer + main (nextron --no-pack, keeps renderer\.next)"
    npx nextron build --no-pack
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "==> Packaging win-unpacked only (electron-builder --win dir)"
    npx electron-builder --win dir
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "==> Built: $BUILT_EXE"
}

if ($relaunch) {
    Stop-VibeFlow
    if (-not (Test-Path $BUILT_EXE)) {
        Write-Error "==> Relaunch: $BUILT_EXE not found — build may have failed"
        exit 1
    }
    Write-Host "==> Relaunching $BUILT_EXE"
    Start-Process -FilePath (Resolve-Path $BUILT_EXE).Path
}

if ($check) {
    if (-not (Test-Path $BUILT_EXE)) {
        Write-Warning "==> Check: $BUILT_EXE not found — skipping boot check"
    } else {
        Write-Host "==> Boot-checking $BUILT_EXE"
        $proc = Start-Process -FilePath (Resolve-Path $BUILT_EXE).Path -PassThru
        Start-Sleep -Seconds 5
        $still = Get-Process -Name "VibeFlow" -ErrorAction SilentlyContinue
        if ($still) {
            Write-Host "    OK — app launched and is running"
        } else {
            Write-Warning "    WARNING — app did not stay running (possible crash)"
        }
        $proc | Stop-Process -Force -ErrorAction SilentlyContinue
        Write-Host "    closed"
    }
}

Write-Host "==> Done. See dist\"
