# WFM System - Register Backend as a Windows Scheduled Task (auto-start)
# Run once on the SERVER PC (as Administrator) after the backend has been built.
#
# After this script runs:
#   - The backend starts automatically whenever Windows boots (even before login).
#   - No manual launch required.
#   - Restarts automatically if it crashes (up to 3 times, 60 second delay each).
#
# Prerequisites:
#   - Tailscale installed and connected on this PC (run: tailscale up)
#   - Node.js installed for all users
#   - PostgreSQL running as a Windows service
#   - Backend .env file configured
#   - Backend compiled (dist/ folder present, or let this script build it)
#
# Usage:  Right-click PowerShell -> Run as Administrator, then:
#         .\scripts\install-autostart.ps1
#
# To stop/remove the task later:
#   Stop-ScheduledTask  -TaskName "WFM Backend"
#   Unregister-ScheduledTask -TaskName "WFM Backend" -Confirm:$false

#Requires -RunAsAdministrator

$taskName   = "WFM Backend"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendDir = (Resolve-Path (Join-Path $scriptRoot "..\packages\backend")).Path
$distIndex  = Join-Path $backendDir "dist\index.js"
$envFile    = Join-Path $backendDir ".env"

Write-Host ""
Write-Host "=== WFM System - Auto-Start Installation ==="
Write-Host ""

# Validate prerequisites
if (-not (Test-Path $envFile)) {
    Write-Error ".env file not found at: $envFile`nEnsure the backend is configured before installing the task."
    exit 1
}

if (-not (Test-Path $distIndex)) {
    Write-Host "Compiled backend not found. Building now..."
    Push-Location $backendDir
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed. Fix TypeScript errors and retry."
        Pop-Location; exit 1
    }
    Pop-Location
    Write-Host "Build complete."
}

# Find node.exe - check PATH, then common install locations
$nodeExe = $null
try { $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source } catch {}
if (-not $nodeExe) {
    foreach ($path in @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe"
    )) {
        if (Test-Path $path) { $nodeExe = $path; break }
    }
}
if (-not $nodeExe) {
    Write-Error "node.exe not found. Install Node.js for All Users from https://nodejs.org and retry."
    exit 1
}
Write-Host "Using node: $nodeExe"
Write-Host "Backend dir: $backendDir"
Write-Host ""

# Remove any existing task with the same name
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Build task components
$action = New-ScheduledTaskAction `
    -Execute          $nodeExe `
    -Argument         "dist\index.js" `
    -WorkingDirectory $backendDir

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit      (New-TimeSpan -Seconds 0) `
    -RestartCount            3 `
    -RestartInterval         (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable      `
    -MultipleInstances       IgnoreNew

# Run as SYSTEM - no password required, starts before login
$principal = New-ScheduledTaskPrincipal `
    -UserId    "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel  Highest

# Register the task
Register-ScheduledTask `
    -TaskName   $taskName `
    -Action     $action `
    -Trigger    $trigger `
    -Settings   $settings `
    -Principal  $principal `
    -Force | Out-Null

Write-Host "Scheduled task registered: '$taskName'"
Write-Host "  Trigger : At system startup (before login)"
Write-Host "  Account : SYSTEM"
Write-Host "  Restart : Up to 3 times on failure (60 s delay)"
Write-Host ""

# Start it immediately so we don't need a reboot to test
Write-Host "Starting the task now..."
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3

$taskInfo = Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo
Write-Host "Task state : $((Get-ScheduledTask -TaskName $taskName).State)"
Write-Host "Last run   : $($taskInfo.LastRunTime)"
Write-Host "Last result: $($taskInfo.LastTaskResult)  (0 = still running / success)"
Write-Host ""

# Show Tailscale IP for employee setup
$tailscaleIP = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $parts = $_.IPAddress.Split('.')
        $parts[0] -eq '100' -and [int]$parts[1] -ge 64 -and [int]$parts[1] -le 127
    } | Select-Object -First 1).IPAddress

Write-Host "=== Employee PC Setup Instructions ==="
if ($tailscaleIP) {
    Write-Host "  Server Tailscale IP: $tailscaleIP"
    Write-Host "  Tell employees to:"
    Write-Host "    1. Install Tailscale from https://tailscale.com/download"
    Write-Host "    2. Sign in to Tailscale with the company account"
    Write-Host "    3. Open WFM System -> Server Setup"
    Write-Host "    4. Enter: http://${tailscaleIP}:3001"
    Write-Host "    5. Click Test and Save"
} else {
    Write-Host "  WARNING: Tailscale IP not detected on this server."
    Write-Host "  Install Tailscale: https://tailscale.com/download"
    Write-Host "  Then run: tailscale up"
    Write-Host "  Re-run this script after Tailscale is connected to see the server IP."
}
Write-Host ""
Write-Host "Verify the backend is running:"
Write-Host "  Invoke-WebRequest http://127.0.0.1:3001/health | Select-Object -Expand Content"
Write-Host ""
Write-Host "To uninstall: Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
Write-Host ""
