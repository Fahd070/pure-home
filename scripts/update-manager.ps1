# WFM System - Automatic Update Manager
# Checks GitHub Releases for a newer version, downloads the installer,
# stops the backend, applies the update, restarts the backend, and verifies.
# Runs every 6 hours via Windows Task Scheduler (registered by install-production.ps1).
#
# Rollback: the previous installer is kept in the backup folder.
# A failed update (backend still down after install) triggers automatic rollback.
#
# Log file:  C:\ProgramData\WFM System\logs\updates.log
# Config:    C:\ProgramData\WFM System\config.json

$ErrorActionPreference = "SilentlyContinue"

# --- Paths ---
$dataDir     = "C:\ProgramData\WFM System"
$configFile  = "$dataDir\config.json"
$logFile     = "$dataDir\logs\updates.log"
$stagingDir  = "$dataDir\updates\staging"
$backupDir   = "$dataDir\updates\backup"

# --- Logging ---
function Write-Log {
    param([string]$Level, [string]$Message)
    $ts   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$Level] $Message"
    Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
}

# --- Config ---
function Get-Config {
    if (-not (Test-Path $configFile)) {
        Write-Log "ERROR" "Config not found: $configFile"
        return $null
    }
    try   { return (Get-Content $configFile -Raw | ConvertFrom-Json) }
    catch { Write-Log "ERROR" "Cannot parse config.json: $_"; return $null }
}

function Save-Config { param($Config)
    try { $Config | ConvertTo-Json -Depth 5 | Set-Content $configFile -Force } catch {}
}

# --- Semantic version comparison ---
# Returns: -1 if A < B, 0 if A = B, 1 if A > B
function Compare-SemVer {
    param([string]$A, [string]$B)
    $aParts = ($A -replace '^v','').Split('.') | ForEach-Object { [int]$_ }
    $bParts = ($B -replace '^v','').Split('.') | ForEach-Object { [int]$_ }
    for ($i = 0; $i -lt 3; $i++) {
        $av = if ($i -lt $aParts.Count) { $aParts[$i] } else { 0 }
        $bv = if ($i -lt $bParts.Count) { $bParts[$i] } else { 0 }
        if ($av -lt $bv) { return -1 }
        if ($av -gt $bv) { return  1 }
    }
    return 0
}

# --- Backend health check ---
function Test-Backend {
    param([int]$Port = 3001, [int]$TimeoutSeconds = 15)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $wc   = New-Object System.Net.WebClient
            $json = $wc.DownloadString("http://127.0.0.1:$Port/health")
            $body = $json | ConvertFrom-Json
            if ($body.status -eq "ok") { return $true }
        } catch {}
        Start-Sleep -Seconds 3
    }
    return $false
}

# --- Stop backend gracefully ---
function Stop-Backend {
    $task = Get-ScheduledTask -TaskName "WFM Backend" -ErrorAction SilentlyContinue
    if ($task -and $task.State -eq "Running") {
        Stop-ScheduledTask -TaskName "WFM Backend" -ErrorAction SilentlyContinue
        Write-Log "INFO" "Stopped scheduled task 'WFM Backend'"
    }
    # Also kill any orphaned node processes serving port 3001
    $nodeProcs = Get-Process -Name "node" -ErrorAction SilentlyContinue
    foreach ($p in $nodeProcs) {
        try {
            $conn = netstat -ano | Select-String ":3001.*$($p.Id)"
            if ($conn) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
        } catch {}
    }
    Start-Sleep -Seconds 3
}

# --- Start backend ---
function Start-Backend {
    $task = Get-ScheduledTask -TaskName "WFM Backend" -ErrorAction SilentlyContinue
    if ($task) {
        Start-ScheduledTask -TaskName "WFM Backend" -ErrorAction SilentlyContinue
        Write-Log "INFO" "Started scheduled task 'WFM Backend'"
    }
}

# --- Download file with progress ---
function Invoke-Download {
    param([string]$Url, [string]$Destination)
    try {
        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add("User-Agent", "WFM-UpdateManager/1.0")
        $wc.DownloadFile($Url, $Destination)
        return $true
    } catch {
        Write-Log "ERROR" "Download failed from $Url : $_"
        return $false
    }
}

# --- Query GitHub API for latest release ---
function Get-LatestRelease {
    param([string]$Repo)
    $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
    try {
        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add("User-Agent", "WFM-UpdateManager/1.0")
        $wc.Headers.Add("Accept", "application/vnd.github+json")
        $json = $wc.DownloadString($apiUrl)
        return $json | ConvertFrom-Json
    } catch {
        Write-Log "WARN" "Could not reach GitHub API ($apiUrl): $_"
        return $null
    }
}

# --- Verify file checksum ---
function Test-Checksum {
    param([string]$FilePath, [string]$ExpectedSha256)
    if (-not $ExpectedSha256) { return $true }  # Skip if not provided
    $actual = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash
    $match  = ($actual -ieq $ExpectedSha256.Trim())
    if (-not $match) {
        Write-Log "ERROR" "Checksum mismatch for $FilePath"
        Write-Log "ERROR" "  Expected: $ExpectedSha256"
        Write-Log "ERROR" "  Actual:   $actual"
    }
    return $match
}

# --- Apply NSIS installer silently ---
function Install-Update {
    param([string]$InstallerPath)
    Write-Log "INFO" "Running installer: $InstallerPath /S"
    $proc = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -Wait -PassThru
    return ($proc.ExitCode -eq 0)
}

# --- Rollback from backup ---
function Invoke-Rollback {
    param([string]$BackupInstallerPath)
    if (-not (Test-Path $BackupInstallerPath)) {
        Write-Log "ERROR" "Rollback failed: backup installer not found at $BackupInstallerPath"
        return $false
    }
    Write-Log "WARN" "Rolling back to previous version: $BackupInstallerPath"
    $proc = Start-Process -FilePath $BackupInstallerPath -ArgumentList "/S" -Wait -PassThru
    return ($proc.ExitCode -eq 0)
}

# ============================================================
# Main
# ============================================================

$config = Get-Config
if (-not $config) { exit 1 }

$repo            = $config.githubRepo
$currentVersion  = $config.installedVersion
$port            = if ($config.backendPort) { $config.backendPort } else { 3001 }
$autoUpdate      = if ($null -ne $config.autoUpdateEnabled) { $config.autoUpdateEnabled } else { $true }

if (-not $autoUpdate) {
    Write-Log "INFO" "Auto-update disabled in config.json"
    exit 0
}

if (-not $repo) {
    Write-Log "ERROR" "githubRepo not set in config.json"
    exit 1
}

Write-Log "INFO" "Checking for updates (current: $currentVersion, repo: $repo)"

# --- Query GitHub ---
$release = Get-LatestRelease -Repo $repo
if (-not $release) {
    Write-Log "WARN" "Skipping update check -- could not reach GitHub"
    exit 0
}

$latestVersion = $release.tag_name -replace '^v', ''
Write-Log "INFO" "Latest release: v$latestVersion"

$cmp = Compare-SemVer $currentVersion $latestVersion
if ($cmp -ge 0) {
    Write-Log "INFO" "Already up to date (v$currentVersion)"
    exit 0
}

Write-Log "INFO" "Update available: v$currentVersion -> v$latestVersion"

# --- Find installer asset ---
$installerAsset = $release.assets | Where-Object { $_.name -like "*Setup*$latestVersion*.exe" -or $_.name -like "*Setup*.exe" } | Select-Object -First 1
if (-not $installerAsset) {
    $installerAsset = $release.assets | Where-Object { $_.name -like "*.exe" } | Select-Object -First 1
}
if (-not $installerAsset) {
    Write-Log "WARN" "No .exe installer found in release v$latestVersion -- skipping"
    exit 0
}

# --- Find optional checksum asset ---
$checksumAsset = $release.assets | Where-Object { $_.name -like "*.sha256" -or $_.name -like "*checksum*" } | Select-Object -First 1
$expectedHash  = ""
if ($checksumAsset) {
    $hashTmp = "$stagingDir\checksum.txt"
    Invoke-Download -Url $checksumAsset.browser_download_url -Destination $hashTmp | Out-Null
    if (Test-Path $hashTmp) {
        $expectedHash = (Get-Content $hashTmp -Raw).Trim().Split(" ")[0]
        Remove-Item $hashTmp -Force
    }
}

# --- Download new installer ---
$stagingInstaller = "$stagingDir\WFM-System-Setup-v$latestVersion.exe"
Write-Log "INFO" "Downloading $($installerAsset.name) ($([math]::Round($installerAsset.size / 1MB, 1)) MB)..."
$downloaded = Invoke-Download -Url $installerAsset.browser_download_url -Destination $stagingInstaller
if (-not $downloaded -or -not (Test-Path $stagingInstaller)) {
    Write-Log "ERROR" "Download failed -- update aborted"
    exit 1
}
Write-Log "INFO" "Download complete: $stagingInstaller"

# --- Verify checksum ---
if (-not (Test-Checksum -FilePath $stagingInstaller -ExpectedSha256 $expectedHash)) {
    Remove-Item $stagingInstaller -Force
    Write-Log "ERROR" "Checksum verification failed -- update aborted (file deleted)"
    exit 1
}

# --- Backup current installer if present ---
$backupInstaller = "$backupDir\WFM-System-Setup-v$currentVersion.exe"
$existingInstaller = "$stagingDir\WFM-System-Setup-v$currentVersion.exe"
if (Test-Path $existingInstaller) {
    Copy-Item $existingInstaller $backupInstaller -Force
}

# --- Stop backend before update ---
Stop-Backend

# --- Apply update ---
Write-Log "INFO" "Applying update v$latestVersion..."
$success = Install-Update -InstallerPath $stagingInstaller

if (-not $success) {
    Write-Log "ERROR" "Installer exited with error -- attempting rollback"
    Start-Backend
    Invoke-Rollback -BackupInstallerPath $backupInstaller | Out-Null
    Start-Backend
    exit 1
}

Write-Log "INFO" "Installer completed"

# --- Restart backend ---
Start-Backend
Start-Sleep -Seconds 10

# --- Verify backend is healthy ---
$healthy = Test-Backend -Port $port -TimeoutSeconds 30
if (-not $healthy) {
    Write-Log "ERROR" "Backend not healthy after update -- rolling back to v$currentVersion"
    Stop-Backend
    Invoke-Rollback -BackupInstallerPath $backupInstaller | Out-Null
    Start-Backend
    Start-Sleep -Seconds 10
    $rolledBack = Test-Backend -Port $port -TimeoutSeconds 20
    if ($rolledBack) {
        Write-Log "WARN" "Rollback to v$currentVersion succeeded"
    } else {
        Write-Log "ERROR" "Rollback also failed -- manual intervention required"
    }
    exit 1
}

# --- Success: persist new version ---
$config.installedVersion = $latestVersion
Save-Config $config

Write-Log "INFO" "Update to v$latestVersion successful and verified"

# --- Clean old staging files (keep last 2) ---
Get-Item "$stagingDir\WFM-System-Setup-*.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 2 |
    Remove-Item -Force
