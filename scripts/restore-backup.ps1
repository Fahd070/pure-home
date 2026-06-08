# Pure Home - Database Restore Script
# Usage: .\restore-backup.ps1 -BackupFile "path\to\wfm-backup-YYYYMMDD-HHMMSS.dump"
#                             [-DirectUrl "postgresql://..."]
#
# Restore source options:
#   A. Automated backups: download the artifact from GitHub Actions
#      → https://github.com/Fahd070/pure-home/actions/workflows/db-backup.yml
#      → Click a workflow run → Artifacts section → download the .zip → extract .dump
#   B. Manual backups: use a .dump file from the backups\ directory
#
# Requires: pg_restore in PATH (installed with PostgreSQL client tools)
# WARNING: This overwrites ALL data in the target database. Back up first.

param(
    [Parameter(Mandatory=$true)]
    [string]$BackupFile,

    [string]$DirectUrl = $env:SUPABASE_DIRECT_URL
)

$ErrorActionPreference = "Stop"

# ── Validate backup file ──────────────────────────────────────────────────────
if (-not (Test-Path $BackupFile)) {
    Write-Error "Backup file not found: $BackupFile"
    exit 1
}

$sizeKB = [math]::Round((Get-Item $BackupFile).Length / 1KB, 1)
if ($sizeKB -lt 1) {
    Write-Error "Backup file is empty: $BackupFile"
    exit 1
}

# Verify the dump is readable before touching the database
Write-Host "Verifying backup integrity..."
$objectCount = (& pg_restore --list $BackupFile | Where-Object { $_ -notmatch '^;' } | Measure-Object).Count
if ($LASTEXITCODE -ne 0) {
    Write-Error "pg_restore --list failed. The backup file may be corrupt."
    exit 1
}
Write-Host "  File:    $BackupFile"
Write-Host "  Size:    $sizeKB KB"
Write-Host "  Objects: $objectCount"

# ── Resolve the direct URL ────────────────────────────────────────────────────
if (-not $DirectUrl) {
    $envPath = Join-Path $PSScriptRoot "..\packages\backend\.env"
    if (Test-Path $envPath) {
        $line = Get-Content $envPath | Where-Object { $_ -match "^SUPABASE_DIRECT_URL=" }
        if ($line) {
            $DirectUrl = $line -replace '^SUPABASE_DIRECT_URL="?|"?\s*$', ''
        }
    }
}

if (-not $DirectUrl) {
    Write-Error "No direct URL provided. See script header for instructions."
    exit 1
}

if ($DirectUrl -match ':6543') {
    Write-Error "DirectUrl uses port 6543 (pgBouncer pooler). Use the direct connection (port 5432)."
    exit 1
}

# ── Confirmation prompt ───────────────────────────────────────────────────────
$dbDisplay = $DirectUrl -replace ':[^@]+@', ':***@'  # hide password in display
Write-Host ""
Write-Host "WARNING: This will OVERWRITE ALL DATA in the target database." -ForegroundColor Red
Write-Host "  Target:  $dbDisplay" -ForegroundColor Yellow
Write-Host "  Source:  $BackupFile" -ForegroundColor Yellow
Write-Host ""
$confirm = Read-Host "Type YES to proceed"
if ($confirm -ne "YES") {
    Write-Host "Restore cancelled."
    exit 0
}

# ── Restore ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Starting restore..."

& pg_restore $DirectUrl `
    --no-acl `
    --no-owner `
    --clean `
    --if-exists `
    $BackupFile

# pg_restore exits non-zero for warnings (e.g. "object does not exist" during --clean).
# Only treat it as failure if the exit code is > 1.
if ($LASTEXITCODE -gt 1) {
    Write-Error "pg_restore failed with exit code $LASTEXITCODE"
    exit 1
}

Write-Host ""
Write-Host "Restore complete." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Verify the backend health check:"
Write-Host "     GET https://pure-home.onrender.com/health"
Write-Host "     Expect: { status: 'ok', database: 'connected' }"
Write-Host "  2. Log into each department and verify data is present."
Write-Host "  3. Record this restore in the audit log."
