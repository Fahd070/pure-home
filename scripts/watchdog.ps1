# Pure Home - Self-Healing Watchdog
# Runs every 60 seconds via Windows Task Scheduler (registered by install-production.ps1).
# Monitors backend health, Tailscale connectivity, and database reachability.
# Automatically repairs any detected failure without requiring manual intervention.
#
# Log file:  C:\ProgramData\Pure Home\logs\watchdog.log  (auto-rotates at 5 MB)
# Config:    C:\ProgramData\Pure Home\config.json

$ErrorActionPreference = "SilentlyContinue"

# --- Paths ---
$dataDir    = "C:\ProgramData\Pure Home"
$configFile = "$dataDir\config.json"
$logFile    = "$dataDir\logs\watchdog.log"
$stateFile  = "$dataDir\watchdog-state.json"

# --- Logging ---
function Write-Log {
    param([string]$Level, [string]$Message)
    $ts   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$Level] $Message"
    Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
}

function Rotate-Log {
    if (-not (Test-Path $logFile)) { return }
    $size = (Get-Item $logFile).Length
    if ($size -gt 5MB) {
        $archive = $logFile -replace "\.log$", ("-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
        Move-Item $logFile $archive -Force
        # Keep only last 3 archives
        Get-Item ($logFile -replace "\.log$", "-*.log") |
            Sort-Object LastWriteTime -Descending |
            Select-Object -Skip 3 |
            Remove-Item -Force
    }
}

# --- Config ---
function Get-Config {
    if (-not (Test-Path $configFile)) {
        Write-Log "ERROR" "Config file not found: $configFile -- run install-production.ps1 first"
        return $null
    }
    try {
        $raw = Get-Content $configFile -Raw
        return $raw | ConvertFrom-Json
    } catch {
        Write-Log "ERROR" "Could not parse config.json: $_"
        return $null
    }
}

# --- Persistent failure state (survives between runs) ---
function Get-State {
    if (-not (Test-Path $stateFile)) { return @{ backendFails = 0; tailscaleFails = 0; lastBackendRepair = 0; lastTailscaleRepair = 0 } }
    try   { return (Get-Content $stateFile -Raw | ConvertFrom-Json) | Select-Object -Property * }
    catch { return @{ backendFails = 0; tailscaleFails = 0; lastBackendRepair = 0; lastTailscaleRepair = 0 } }
}

function Save-State { param($State)
    try { $State | ConvertTo-Json | Set-Content $stateFile -Force } catch {}
}

# --- Backend health ---
function Test-Backend {
    param([int]$Port = 3001)
    try {
        $wc   = New-Object System.Net.WebClient
        $wc.Headers.Add("User-Agent", "WFM-Watchdog/1.0")
        $json = $wc.DownloadString("http://127.0.0.1:$Port/health")
        $body = $json | ConvertFrom-Json
        return @{ up = ($body.status -eq "ok"); dbConnected = ($body.database -eq "connected") }
    } catch {
        return @{ up = $false; dbConnected = $false }
    }
}

# --- Start / restart backend ---
function Repair-Backend {
    param($Config)
    Write-Log "REPAIR" "Backend is down -- attempting recovery"

    # Try to restart the scheduled task first (cleanest method)
    $task = Get-ScheduledTask -TaskName "WFM Backend" -ErrorAction SilentlyContinue
    if ($task) {
        if ($task.State -eq "Running") {
            Stop-ScheduledTask -TaskName "WFM Backend" -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 3
        }
        Start-ScheduledTask -TaskName "WFM Backend" -ErrorAction SilentlyContinue
        Write-Log "REPAIR" "Restarted scheduled task 'WFM Backend'"
        Start-Sleep -Seconds 8
        return $true
    }

    # Fallback: launch node directly if no task exists
    $backendDir  = $Config.backendDir
    $distIndex   = Join-Path $backendDir "dist\index.js"
    if (-not (Test-Path $distIndex)) {
        Write-Log "ERROR" "Backend dist not found at: $distIndex"
        return $false
    }
    $nodeExe = $null
    try { $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source } catch {}
    if (-not $nodeExe) {
        foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
            if (Test-Path $p) { $nodeExe = $p; break }
        }
    }
    if (-not $nodeExe) {
        Write-Log "ERROR" "node.exe not found -- cannot start backend"
        return $false
    }
    Start-Process -FilePath $nodeExe -ArgumentList "dist\index.js" -WorkingDirectory $backendDir -WindowStyle Hidden
    Write-Log "REPAIR" "Launched node dist/index.js directly from $backendDir"
    Start-Sleep -Seconds 8
    return $true
}

# --- Tailscale check ---
function Get-TailscaleIP {
    $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $parts = $_.IPAddress.Split('.')
            $parts.Count -eq 4 -and
            $parts[0] -eq '100' -and
            [int]$parts[1] -ge 64 -and
            [int]$parts[1] -le 127
        } | Select-Object -First 1
    return $addr.IPAddress
}

function Test-Tailscale {
    $ip = Get-TailscaleIP
    return [bool]$ip
}

function Repair-Tailscale {
    param($Config)
    Write-Log "REPAIR" "Tailscale disconnected -- attempting reconnect"

    $authKey = $Config.tailscaleAuthKey
    $tailscaleExe = $null
    foreach ($p in @("$env:ProgramFiles\Tailscale\tailscale.exe", "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe")) {
        if (Test-Path $p) { $tailscaleExe = $p; break }
    }
    if (-not $tailscaleExe) {
        try { $tailscaleExe = (Get-Command tailscale.exe -ErrorAction Stop).Source } catch {}
    }
    if (-not $tailscaleExe) {
        Write-Log "ERROR" "tailscale.exe not found"
        return $false
    }

    # Ensure service is running
    $svc = Get-Service -Name "Tailscale" -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne "Running") {
        Start-Service -Name "Tailscale" -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 5
    }

    if ($authKey -and $authKey -ne "") {
        # Auth key method: no browser needed, always works unattended
        $result = & $tailscaleExe up --authkey $authKey --reset --unattended 2>&1
        Write-Log "REPAIR" "tailscale up --authkey result: $result"
    } else {
        # No auth key configured -- just bring up (works if already authenticated)
        $result = & $tailscaleExe up --reset 2>&1
        Write-Log "REPAIR" "tailscale up result: $result"
    }

    Start-Sleep -Seconds 8
    $connected = Test-Tailscale
    if ($connected) {
        Write-Log "REPAIR" "Tailscale reconnected: $(Get-TailscaleIP)"
    } else {
        Write-Log "ERROR" "Tailscale reconnect failed. Set tailscaleAuthKey in config.json and re-run install-production.ps1"
    }
    return $connected
}

# --- PostgreSQL check ---
function Test-Database {
    param([string]$DbUrl)
    if ($DbUrl -notmatch 'postgresql://[^:]+:[^@]+@([^:/]+):(\d+)/') { return $true }
    $host = $Matches[1]; $port = [int]$Matches[2]
    $tcp  = New-Object System.Net.Sockets.TcpClient
    try {
        $tcp.Connect($host, $port)
        return $true
    } catch {
        return $false
    } finally {
        $tcp.Close()
    }
}

# ============================================================
# Main
# ============================================================

Rotate-Log

$config = Get-Config
if (-not $config) { exit 1 }

$state = Get-State
$now   = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$port  = if ($config.backendPort) { $config.backendPort } else { 3001 }

# --- Check backend ---
$health = Test-Backend -Port $port

if (-not $health.up) {
    $state.backendFails++

    # Exponential backoff: only repair if enough time has passed
    $backoffSeconds = [math]::Min(300, [math]::Pow(2, $state.backendFails - 1) * 30)
    $timeSinceRepair = $now - $state.lastBackendRepair

    if ($timeSinceRepair -ge $backoffSeconds) {
        Write-Log "WARN" "Backend health check failed (consecutive failures: $($state.backendFails))"
        $repaired = Repair-Backend -Config $config
        $state.lastBackendRepair = $now

        # Verify repair succeeded
        Start-Sleep -Seconds 5
        $recheck = Test-Backend -Port $port
        if ($recheck.up) {
            Write-Log "INFO" "Backend recovered successfully"
            $state.backendFails = 0
        } else {
            Write-Log "ERROR" "Backend repair attempted but still not responding (attempt $($state.backendFails))"
        }
    }
} else {
    if ($state.backendFails -gt 0) {
        Write-Log "INFO" "Backend is healthy (was failing $($state.backendFails) times)"
    }
    $state.backendFails = 0

    # Warn if database is disconnected even though backend is up
    if (-not $health.dbConnected) {
        Write-Log "WARN" "Backend up but database disconnected -- check PostgreSQL service"
    }
}

# --- Check Tailscale ---
$tailscaleOk = Test-Tailscale

if (-not $tailscaleOk) {
    $state.tailscaleFails++
    $backoffSeconds  = [math]::Min(600, [math]::Pow(2, $state.tailscaleFails - 1) * 60)
    $timeSinceRepair = $now - $state.lastTailscaleRepair

    if ($timeSinceRepair -ge $backoffSeconds) {
        Write-Log "WARN" "Tailscale disconnected (consecutive failures: $($state.tailscaleFails))"
        Repair-Tailscale -Config $config | Out-Null
        $state.lastTailscaleRepair = $now

        if (Test-Tailscale) {
            $state.tailscaleFails = 0
        }
    }
} else {
    if ($state.tailscaleFails -gt 0) {
        Write-Log "INFO" "Tailscale reconnected (was failing $($state.tailscaleFails) times)"
    }
    $state.tailscaleFails = 0
}

# --- Persist state ---
Save-State $state
