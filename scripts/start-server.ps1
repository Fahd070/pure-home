# Pure Home - Backend Startup Script
# Run on the SERVER PC. PostgreSQL must already be running as a Windows service.
#
# Usage:  Double-click, or run in PowerShell:
#         .\scripts\start-server.ps1
#
# NOTE: In production, the backend runs automatically via the Windows Scheduled Task
# registered by install-production.ps1. Use this script for manual starts or debugging.

$ErrorActionPreference = "Stop"

$backendDir = Join-Path $PSScriptRoot "..\packages\backend"
$envFile    = Join-Path $backendDir ".env"

Write-Host ""
Write-Host "=== Pure Home - Starting Backend Server ==="
Write-Host ""

# Verify .env exists
if (-not (Test-Path $envFile)) {
    Write-Error ".env file not found at: $envFile`nCopy .env.example to .env and fill in the values."
    exit 1
}

# Check PostgreSQL is reachable
Write-Host "Checking PostgreSQL..."
$dbUrlLine = Get-Content $envFile | Where-Object { $_ -match "^DATABASE_URL=" }
$dbUrl     = $dbUrlLine -replace '^DATABASE_URL="?', '' -replace '"?$', ''

if ($dbUrl -match 'postgresql://[^:]+:[^@]+@([^:/]+):(\d+)/') {
    $dbHost = $Matches[1]; $dbPort = [int]$Matches[2]
    $tcpClient = New-Object System.Net.Sockets.TcpClient
    try {
        $tcpClient.Connect($dbHost, $dbPort)
        Write-Host "  PostgreSQL reachable on ${dbHost}:${dbPort} (OK)"
    } catch {
        Write-Host "  WARNING: Cannot connect to PostgreSQL on ${dbHost}:${dbPort}"
        Write-Host "           Start the PostgreSQL service: services.msc -> postgresql-x64-xx -> Start"
    } finally {
        $tcpClient.Close()
    }
}

# Detect Tailscale IP (100.64.0.0/10) and LAN IP
$tailscaleIP = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $parts = $_.IPAddress.Split('.')
        $parts[0] -eq '100' -and [int]$parts[1] -ge 64 -and [int]$parts[1] -le 127
    } | Select-Object -First 1).IPAddress

$lanIP = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.PrefixOrigin -in @("Dhcp","Manual") -and
                   $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "100.*" } |
    Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "Server will be available at:"
Write-Host "  Local:     http://127.0.0.1:3001"

if ($tailscaleIP) {
    Write-Host "  Tailscale: http://${tailscaleIP}:3001  <- give this URL to all employee PCs"
} else {
    Write-Host "  Tailscale: NOT DETECTED - install Tailscale and run 'tailscale up'"
    Write-Host "             Employees will not be able to connect without Tailscale."
}

if ($lanIP) {
    Write-Host "  LAN:       http://${lanIP}:3001  (same office network, no Tailscale needed)"
}

Write-Host ""
if ($tailscaleIP) {
    Write-Host "Employee PC setup:"
    Write-Host "  1. Install Tailscale on the employee PC and join the same tailnet"
    Write-Host "  2. Open Pure Home -> Server Setup -> enter: http://${tailscaleIP}:3001"
    Write-Host "  3. Click Test and Save"
}
Write-Host ""
Write-Host "Press Ctrl+C to stop the server."
Write-Host ""

# Start the backend (use compiled JS if available, otherwise ts-node-dev for dev)
Set-Location $backendDir
$distIndex = Join-Path $backendDir "dist\index.js"
if (Test-Path $distIndex) {
    Write-Host "Starting: node dist/index.js"
    node dist/index.js
} else {
    Write-Host "Compiled backend not found. Building first..."
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Error "Build failed."; exit 1 }
    Write-Host "Starting: node dist/index.js"
    node dist/index.js
}
