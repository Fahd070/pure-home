# WFM System - Production Installation Script
# Run ONCE on the SERVER PC as Administrator after initial setup.
# Sets up all scheduled tasks, firewall rules, Tailscale auth, and config.
#
# This script replaces install-autostart.ps1, configure-firewall.ps1,
# and install-tailscale-server.ps1 -- it does everything in one pass.
#
# Usage:
#   .\scripts\install-production.ps1 -TailscaleAuthKey "tskey-auth-xxxx"
#
# To get a Tailscale auth key:
#   1. Open https://login.tailscale.com/admin/settings/keys
#   2. Click "Generate auth key"
#   3. Enable "Reusable" so all machines can use the same key
#   4. Set expiry to maximum or "no expiry"
#   5. Copy the key and pass it to this script
#
# To update the auth key later (if it expires):
#   .\scripts\install-production.ps1 -TailscaleAuthKey "tskey-auth-newkey" -UpdateKeyOnly

param(
    [string]$TailscaleAuthKey = "",
    [string]$CurrentVersion   = "1.0.0",
    [switch]$UpdateKeyOnly,
    [switch]$Force
)

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot   = Resolve-Path (Join-Path $scriptRoot "..") | Select-Object -ExpandProperty Path

# --- Paths ---
$dataDir       = "C:\ProgramData\WFM System"
$configFile    = "$dataDir\config.json"
$logDir        = "$dataDir\logs"
$stagingDir    = "$dataDir\updates\staging"
$backupDir     = "$dataDir\updates\backup"
$backendDir    = Join-Path $repoRoot "packages\backend"
$watchdogScript = Join-Path $scriptRoot "watchdog.ps1"
$updateScript   = Join-Path $scriptRoot "update-manager.ps1"

Write-Host ""
Write-Host "============================================================"
Write-Host " WFM System - Production Installation"
Write-Host "============================================================"
Write-Host ""

# --- Validate prerequisites ---
Write-Host "Checking prerequisites..."

$nodeExe = $null
try { $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source } catch {}
if (-not $nodeExe) {
    foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
        if (Test-Path $p) { $nodeExe = $p; break }
    }
}
if (-not $nodeExe) {
    Write-Host "  ERROR: node.exe not found. Install Node.js (LTS) from https://nodejs.org"
    exit 1
}
Write-Host "  Node.js: $nodeExe"

$distIndex = Join-Path $backendDir "dist\index.js"
if (-not (Test-Path $distIndex)) {
    Write-Host "  Backend not compiled. Building now..."
    Push-Location $backendDir
    npm run build
    Pop-Location
    if (-not (Test-Path $distIndex)) {
        Write-Host "  ERROR: Backend build failed -- check TypeScript errors"
        exit 1
    }
}
Write-Host "  Backend: $distIndex"

$envFile = Join-Path $backendDir ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "  ERROR: .env not found at $envFile -- copy .env.example and fill in values"
    exit 1
}
Write-Host "  Config:  $envFile"

# --- Create directory structure ---
Write-Host ""
Write-Host "Creating data directories..."
foreach ($d in @($dataDir, $logDir, $stagingDir, $backupDir)) {
    New-Item -ItemType Directory -Force $d | Out-Null
}
Write-Host "  $dataDir"

# --- Write / update config.json ---
Write-Host ""
Write-Host "Writing production config..."

if ((Test-Path $configFile) -and -not $Force -and -not $UpdateKeyOnly) {
    $existing = Get-Content $configFile -Raw | ConvertFrom-Json
    # Preserve installed version if already set
    if ($existing.installedVersion -and $CurrentVersion -eq "1.0.0") {
        $CurrentVersion = $existing.installedVersion
    }
}

if ($UpdateKeyOnly) {
    if (-not (Test-Path $configFile)) {
        Write-Host "  ERROR: config.json not found. Run the full install first."
        exit 1
    }
    $cfg = Get-Content $configFile -Raw | ConvertFrom-Json
    $cfg.tailscaleAuthKey = $TailscaleAuthKey
    $cfg | ConvertTo-Json -Depth 5 | Set-Content $configFile -Force
    Write-Host "  Tailscale auth key updated in config.json"
    Write-Host ""
    Write-Host "Re-authenticating Tailscale with new key..."
    & tailscale up --authkey $TailscaleAuthKey --reset --unattended 2>&1 | Out-Null
    Start-Sleep -Seconds 5
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
           Where-Object { $parts = $_.IPAddress.Split('.'); $parts[0] -eq '100' -and [int]$parts[1] -ge 64 -and [int]$parts[1] -le 127 } |
           Select-Object -First 1).IPAddress
    if ($ip) { Write-Host "  Connected: $ip" } else { Write-Host "  WARNING: Tailscale not yet connected" }
    exit 0
}

$config = [PSCustomObject]@{
    tailscaleAuthKey    = $TailscaleAuthKey
    githubRepo          = "Fahd070/wfm-system"
    backendPort         = 3001
    backendDir          = $backendDir
    installDir          = "C:\Program Files\WFM System"
    installedVersion    = $CurrentVersion
    watchdogEnabled     = $true
    autoUpdateEnabled   = $true
    maxRestartAttempts  = 3
}
$config | ConvertTo-Json -Depth 5 | Set-Content $configFile -Force
Write-Host "  Config written: $configFile"

# Restrict read access to Administrators + SYSTEM only (auth key is sensitive)
$acl = Get-Acl $configFile
$acl.SetAccessRuleProtection($true, $false)
$adminRule  = New-Object System.Security.AccessControl.FileSystemAccessRule("Administrators", "FullControl", "Allow")
$systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM",         "FullControl", "Allow")
$acl.AddAccessRule($adminRule)
$acl.AddAccessRule($systemRule)
Set-Acl $configFile $acl
Write-Host "  Config permissions: Administrators + SYSTEM only (auth key protected)"

# --- Configure Tailscale ---
Write-Host ""
Write-Host "Configuring Tailscale..."

$tailscaleExe = $null
foreach ($p in @("$env:ProgramFiles\Tailscale\tailscale.exe", "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe")) {
    if (Test-Path $p) { $tailscaleExe = $p; break }
}
if (-not $tailscaleExe) {
    try { $tailscaleExe = (Get-Command tailscale.exe -ErrorAction Stop).Source } catch {}
}

if ($tailscaleExe) {
    $svc = Get-Service -Name "Tailscale" -ErrorAction SilentlyContinue
    if ($svc -and $svc.StartType -ne "Automatic") {
        Set-Service -Name "Tailscale" -StartupType Automatic
    }

    if ($TailscaleAuthKey -ne "") {
        Write-Host "  Authenticating with auth key (unattended mode)..."
        & $tailscaleExe up --authkey $TailscaleAuthKey --reset --unattended 2>&1 | Out-Null
        Start-Sleep -Seconds 8
    }

    $tailscaleIP = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $parts = $_.IPAddress.Split('.')
            $parts[0] -eq '100' -and [int]$parts[1] -ge 64 -and [int]$parts[1] -le 127
        } | Select-Object -First 1).IPAddress

    if ($tailscaleIP) {
        Write-Host "  Tailscale connected: $tailscaleIP"
    } else {
        Write-Host "  WARNING: Tailscale not connected."
        if ($TailscaleAuthKey -eq "") {
            Write-Host "  Re-run with: .\scripts\install-production.ps1 -TailscaleAuthKey tskey-auth-xxxx"
            Write-Host "  Get a key at: https://login.tailscale.com/admin/settings/keys"
        }
    }
} else {
    Write-Host "  WARNING: Tailscale not installed. Install from https://tailscale.com/download"
}

# --- Configure firewall ---
Write-Host ""
Write-Host "Configuring firewall (port 3001)..."

# Tailscale CGNAT range (100.64.0.0/10)
$ruleName1 = "WFM Backend - Tailscale (port 3001)"
$existing1 = Get-NetFirewallRule -DisplayName $ruleName1 -ErrorAction SilentlyContinue
if ($existing1) { Remove-NetFirewallRule -DisplayName $ruleName1 }
New-NetFirewallRule -DisplayName $ruleName1 -Direction Inbound -Protocol TCP -LocalPort 3001 `
    -RemoteAddress "100.64.0.0/10" -Action Allow -Profile Any `
    -Description "WFM employee PCs on Tailscale reach the backend" | Out-Null
Write-Host "  Rule: $ruleName1"

# LAN fallback (Private profile)
$ruleName2 = "WFM Backend - LAN fallback (port 3001)"
$existing2 = Get-NetFirewallRule -DisplayName $ruleName2 -ErrorAction SilentlyContinue
if ($existing2) { Remove-NetFirewallRule -DisplayName $ruleName2 }
New-NetFirewallRule -DisplayName $ruleName2 -Direction Inbound -Protocol TCP -LocalPort 3001 `
    -Action Allow -Profile Private `
    -Description "WFM LAN access (Private network)" | Out-Null
Write-Host "  Rule: $ruleName2"

# --- Register scheduled tasks ---
Write-Host ""
Write-Host "Registering scheduled tasks..."

# Task 1: WFM Backend (starts at boot, restarts on crash)
Unregister-ScheduledTask -TaskName "WFM Backend" -Confirm:$false -ErrorAction SilentlyContinue

$backendAction = New-ScheduledTaskAction -Execute $nodeExe -Argument "dist\index.js" -WorkingDirectory $backendDir
$backendTrigger = New-ScheduledTaskTrigger -AtStartup
$backendSettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew
$backendPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "WFM Backend" -Action $backendAction -Trigger $backendTrigger `
    -Settings $backendSettings -Principal $backendPrincipal -Force | Out-Null
Write-Host "  [OK] WFM Backend      -- starts at boot, restarts on crash (up to 10 times)"

# Task 2: WFM Watchdog (runs every 1 minute)
Unregister-ScheduledTask -TaskName "WFM Watchdog" -Confirm:$false -ErrorAction SilentlyContinue

$psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
if (-not $psExe) { $psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" }
$watchdogAction = New-ScheduledTaskAction `
    -Execute $psExe `
    -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdogScript`""
$watchdogTrigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 1) -Once -At (Get-Date).Date
$watchdogSettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RunOnlyIfNetworkAvailable:$false
$watchdogPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "WFM Watchdog" -Action $watchdogAction -Trigger $watchdogTrigger `
    -Settings $watchdogSettings -Principal $watchdogPrincipal -Force | Out-Null
Write-Host "  [OK] WFM Watchdog     -- runs every 60 seconds, self-heals backend + Tailscale"

# Task 3: WFM Update Manager (runs every 6 hours)
Unregister-ScheduledTask -TaskName "WFM Update Manager" -Confirm:$false -ErrorAction SilentlyContinue

$updateAction = New-ScheduledTaskAction `
    -Execute $psExe `
    -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$updateScript`""
# Trigger: start at 03:00 today, repeat every 6 hours indefinitely
$updateTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At "03:00" `
    -RepetitionInterval (New-TimeSpan -Hours 6) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$updateSettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew
$updatePrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "WFM Update Manager" -Action $updateAction -Trigger $updateTrigger `
    -Settings $updateSettings -Principal $updatePrincipal -Force | Out-Null
Write-Host "  [OK] WFM Update Manager -- checks GitHub every 6 hours, applies updates silently"

# --- Start backend now ---
Write-Host ""
Write-Host "Starting backend..."
Start-ScheduledTask -TaskName "WFM Backend" -ErrorAction SilentlyContinue
Start-Sleep -Seconds 10

# --- Verify ---
Write-Host ""
Write-Host "Verifying deployment..."

$backendOk = $false
try {
    $wc   = New-Object System.Net.WebClient
    $json = $wc.DownloadString("http://127.0.0.1:3001/health")
    $body = $json | ConvertFrom-Json
    $backendOk = ($body.status -eq "ok")
    Write-Host "  Backend health:   $($body.status) (database: $($body.database))"
} catch {
    Write-Host "  Backend health:   NOT RESPONDING (check logs)"
}

$tailscaleIP = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $parts = $_.IPAddress.Split('.')
        $parts[0] -eq '100' -and [int]$parts[1] -ge 64 -and [int]$parts[1] -le 127
    } | Select-Object -First 1).IPAddress
$tailscaleStatus = if ($tailscaleIP) { "Connected: $tailscaleIP" } else { "NOT CONNECTED" }
Write-Host "  Tailscale:        $tailscaleStatus"

$taskStatus = (Get-ScheduledTask -TaskName "WFM Backend").State
Write-Host "  WFM Backend task: $taskStatus"

Write-Host ""
Write-Host "============================================================"
Write-Host " PRODUCTION INSTALLATION COMPLETE"
Write-Host "============================================================"
Write-Host ""

if ($tailscaleIP) {
    Write-Host "  Server Tailscale IP : $tailscaleIP"
    Write-Host "  Employee setup URL  : http://${tailscaleIP}:3001"
    Write-Host ""
    Write-Host "  For each employee PC, run:"
    Write-Host "    .\scripts\setup-tailscale-client.ps1 -AuthKey <key> -ServerIP $tailscaleIP"
}

Write-Host ""
Write-Host "  Active scheduled tasks:"
Write-Host "    'WFM Backend'       -- backend server (auto-start, auto-restart)"
Write-Host "    'WFM Watchdog'      -- self-healing monitor (every 60 s)"
Write-Host "    'WFM Update Manager'-- auto-update from GitHub (every 6 h)"
Write-Host ""
Write-Host "  Logs:"
Write-Host "    Watchdog : $dataDir\logs\watchdog.log"
Write-Host "    Updates  : $dataDir\logs\updates.log"
Write-Host ""
Write-Host "  To update the Tailscale auth key:"
Write-Host "    .\scripts\install-production.ps1 -UpdateKeyOnly -TailscaleAuthKey tskey-auth-xxxx"
Write-Host ""
