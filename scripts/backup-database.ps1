# WFM System - Database Backup Script
# Usage: .\backup-database.ps1
# Requires: pg_dump in PATH (installed with PostgreSQL)

$ErrorActionPreference = "Stop"

# Load from .env
$envPath = Join-Path $PSScriptRoot "..\packages\backend\.env"
if (-not (Test-Path $envPath)) {
    Write-Error "Cannot find .env at $envPath"
    exit 1
}

# Parse DATABASE_URL from .env
$dbUrl = (Get-Content $envPath | Where-Object { $_ -match "^DATABASE_URL=" }) -replace '^DATABASE_URL="?|"?$', ''
if (-not $dbUrl) {
    Write-Error "DATABASE_URL not found in .env"
    exit 1
}

# Extract components from postgresql://user:pass@host:port/dbname
if ($dbUrl -match 'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)') {
    $dbUser = $Matches[1]
    $dbPass = $Matches[2]
    $dbHost = $Matches[3]
    $dbPort = $Matches[4]
    $dbName = $Matches[5]
} else {
    Write-Error "Could not parse DATABASE_URL"
    exit 1
}

# Create backups directory
$backupDir = Join-Path $PSScriptRoot "..\backups"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

# Timestamped filename
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupFile = Join-Path $backupDir "wfm_backup_$timestamp.sql"

Write-Host "Backing up database '$dbName' to: $backupFile"

$env:PGPASSWORD = $dbPass
try {
    & pg_dump -h $dbHost -p $dbPort -U $dbUser -d $dbName -f $backupFile
    if ($LASTEXITCODE -eq 0) {
        $size = (Get-Item $backupFile).Length
        Write-Host "Backup complete. Size: $([math]::Round($size/1KB, 1)) KB"
    } else {
        Write-Error "pg_dump failed with exit code $LASTEXITCODE"
    }
} finally {
    $env:PGPASSWORD = ""
}

# Keep only the last 14 backups
$backups = Get-ChildItem $backupDir -Filter "wfm_backup_*.sql" | Sort-Object LastWriteTime -Descending
if ($backups.Count -gt 14) {
    $backups | Select-Object -Skip 14 | ForEach-Object {
        Remove-Item $_.FullName
        Write-Host "Removed old backup: $($_.Name)"
    }
}

Write-Host "Done."
