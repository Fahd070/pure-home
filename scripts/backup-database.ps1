# Pure Home - Manual Database Backup Script
# Usage: .\backup-database.ps1 [-DirectUrl "postgresql://..."]
#
# Requires: pg_dump in PATH (installed with PostgreSQL client tools)
# IMPORTANT: Use the DIRECT connection URL (port 5432), NOT the pooler URL (port 6543).
#   Supabase Dashboard → Project Settings → Database → Connection String → URI mode
#
# Automated daily backups run via GitHub Actions (.github/workflows/db-backup.yml).
# This script is for on-demand manual backups only.

param(
    [string]$DirectUrl = $env:SUPABASE_DIRECT_URL
)

$ErrorActionPreference = "Stop"

# ── Resolve the direct URL ────────────────────────────────────────────────────
if (-not $DirectUrl) {
    # Try reading SUPABASE_DIRECT_URL from .env in the backend package
    $envPath = Join-Path $PSScriptRoot "..\packages\backend\.env"
    if (Test-Path $envPath) {
        $line = Get-Content $envPath | Where-Object { $_ -match "^SUPABASE_DIRECT_URL=" }
        if ($line) {
            $DirectUrl = $line -replace '^SUPABASE_DIRECT_URL="?|"?\s*$', ''
        }
    }
}

if (-not $DirectUrl) {
    Write-Error @"
No direct URL provided. Either:
  1. Pass it explicitly: .\backup-database.ps1 -DirectUrl "postgresql://postgres:PASSWORD@db.REF.supabase.co:5432/postgres"
  2. Set environment variable SUPABASE_DIRECT_URL
  3. Add SUPABASE_DIRECT_URL to packages/backend/.env

The direct URL is found at:
  Supabase Dashboard → Project Settings → Database → Connection String → URI mode
  (use port 5432, NOT the pooler port 6543)
"@
    exit 1
}

# Reject pooler URLs — pg_dump hangs on transaction-mode pgBouncer
if ($DirectUrl -match ':6543') {
    Write-Error "DirectUrl uses port 6543 (pgBouncer pooler). Use the direct connection (port 5432) for pg_dump."
    exit 1
}

# ── Create backups directory ──────────────────────────────────────────────────
$backupDir = Join-Path $PSScriptRoot "..\backups"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

# ── Run pg_dump ───────────────────────────────────────────────────────────────
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path $backupDir "wfm-backup-$timestamp.dump"

Write-Host "Starting backup..."
Write-Host "Output: $backupFile"

& pg_dump $DirectUrl `
    --format=custom `
    --no-acl `
    --no-owner `
    --compress=9 `
    --file=$backupFile

if ($LASTEXITCODE -ne 0) {
    Write-Error "pg_dump failed with exit code $LASTEXITCODE"
    exit 1
}

# ── Verify ────────────────────────────────────────────────────────────────────
$sizeKB = [math]::Round((Get-Item $backupFile).Length / 1KB, 1)
$objectCount = (& pg_restore --list $backupFile | Where-Object { $_ -notmatch '^;' } | Measure-Object).Count

if ($objectCount -lt 5) {
    Write-Warning "Backup contains only $objectCount objects — verify database has data."
}

Write-Host "Backup complete."
Write-Host "  File:    $backupFile"
Write-Host "  Size:    $sizeKB KB"
Write-Host "  Objects: $objectCount"

# ── Retention: keep last 30 local backups ────────────────────────────────────
$existing = Get-ChildItem $backupDir -Filter "wfm-backup-*.dump" | Sort-Object LastWriteTime -Descending
if ($existing.Count -gt 30) {
    $existing | Select-Object -Skip 30 | ForEach-Object {
        Remove-Item $_.FullName
        Write-Host "Removed old backup: $($_.Name)"
    }
}

Write-Host "Done."
