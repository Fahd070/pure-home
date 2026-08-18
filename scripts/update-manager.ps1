# Pure Home - Update Manager (DEPRECATED — safe no-op stub)
#
# This script used to check GitHub Releases for a newer version, download the
# installer, STOP THE SHARED BACKEND, apply the update, and restart the
# backend -- all on an unattended 6-hour Windows Scheduled Task timer.
#
# That design is retired. `electron-updater`, running inside the Pure Home
# desktop app itself, is now the single canonical update mechanism (see
# packages/unified-app/electron/main/index.ts). Running two independent
# updaters against the same installation could let this scheduled task force-
# kill the backend and every connected employee's session at an arbitrary
# moment, including one already in the middle of downloading/installing an
# update via the in-app updater. See docs/LEGACY-UPDATE-MANAGER-DEPRECATION.md
# for the full rationale and the one-time cleanup procedure for machines that
# already have the old "WFM Update Manager" scheduled task registered.
#
# This file is intentionally kept at its original path (rather than deleted)
# because existing installations' Scheduled Tasks still point at it by path.
# If one of those still fires this script, it must do nothing harmful: no
# backend stop/start, no process kill, no installer download or execution.
# It only logs that it ran and exits cleanly.
#
# `scripts/install-production.ps1` no longer registers this scheduled task for
# new/re-run installs. `scripts/remove-legacy-update-task.ps1` is the
# idempotent, manually-run cleanup for machines that already have it
# registered from a previous install.
#
# Log file: C:\ProgramData\Pure Home\logs\updates.log

$ErrorActionPreference = "SilentlyContinue"

$dataDir = "C:\ProgramData\Pure Home"
$logFile = "$dataDir\logs\updates.log"

function Write-Log {
    param([string]$Level, [string]$Message)
    $ts   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$Level] $Message"
    Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
}

Write-Log "INFO" "update-manager.ps1 is deprecated and took no action. Desktop updates are handled exclusively by the in-app updater (electron-updater). See docs/LEGACY-UPDATE-MANAGER-DEPRECATION.md. If this task still fires periodically, run scripts/remove-legacy-update-task.ps1 once as Administrator to remove it."

exit 0
