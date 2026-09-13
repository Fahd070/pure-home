# Pure Home - Remove Legacy "WFM Update Manager" Scheduled Task
#
# One-time, idempotent cleanup for server PCs that were set up while a
# scheduled task was still allowed to install desktop updates unattended.
# See docs/LEGACY-UPDATE-MANAGER-DEPRECATION.md for why this task is retired.
#
# This script does ONLY one thing: unregisters the "WFM Update Manager"
# Scheduled Task if it exists. It does not touch "WFM Backend", "WFM
# Watchdog", or any other scheduled task, and it does not stop or start any
# process. Safe to run more than once -- it simply reports "not found" if
# the task was already removed.
#
# This script is NOT run automatically by anything in this repository or by
# any install script. An administrator must run it deliberately, once, on
# each server PC that still has the legacy task registered:
#
#   .\scripts\remove-legacy-update-task.ps1
#
# (Run as Administrator -- Scheduled Task registration is machine-wide.)

#Requires -RunAsAdministrator

$TaskName = "WFM Update Manager"

Write-Host ""
Write-Host "Checking for legacy scheduled task '$TaskName'..."

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if (-not $task) {
    Write-Host "  Not found -- nothing to do. This machine is already clean."
    exit 0
}

Write-Host "  Found (state: $($task.State)). Removing..."
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
Write-Host "  Removed '$TaskName'."
Write-Host ""
Write-Host "Desktop updates on this machine are now manual. Pure Home never checks"
Write-Host "for updates on its own; install a new version by downloading the"
Write-Host "installer from the download site and running it as Administrator."
Write-Host ""
