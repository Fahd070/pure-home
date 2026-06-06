# WFM System — Backend Startup Script
# Run on the SERVER PC each time before employees start work.
# PostgreSQL must already be running (it starts automatically as a Windows service).
#
# Usage:  Double-click, or run in PowerShell:
#         .\scripts\start-server.ps1

$ErrorActionPreference = "Stop"

$backendDir = Join-Path $PSScriptRoot "..\packages\backend"
$envFile    = Join-Path $backendDir ".env"

Write-Host ""
Write-Host "=== WFM System — Starting Backend Server ==="
Write-Host ""

# Verify .env exists
if (-not (Test-Path $envFile)) {
    Write-Error ".env file not found at: $envFile`nCopy .env.example to .env and fill in the values."
    exit 1
}

# Check PostgreSQL is reachable
Write-Host "Checking PostgreSQL..."
$dbUrl = (Get-Content $envFile | Where-Object { $_ -match "^DATABASE_URL=" }) -replace '^DATABASE_URL="?|"?$', ''
if ($dbUrl -match 'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)') {
    $dbHost = $Matches[3]; $dbPort = [int]$Matches[4]
    $tcpClient = New-Object System.Net.Sockets.TcpClient
    try {
        $tcpClient.Connect($dbHost, $dbPort)
        Write-Host "PostgreSQL is reachable on ${dbHost}:${dbPort}"
    } catch {
        Write-Host "WARNING: Cannot connect to PostgreSQL on ${dbHost}:${dbPort}"
        Write-Host "         Start the PostgreSQL service: services.msc → postgresql-x64-xx → Start"
    } finally { $tcpClient.Close() }
}

# Show the machine's LAN IP
$lanIP = (Get-NetIPAddress -AddressFamily IPv4 |
          Where-Object { $_.PrefixOrigin -eq "Dhcp" -or $_.PrefixOrigin -eq "Manual" } |
          Where-Object { $_.IPAddress -notlike "127.*" } |
          Select-Object -First 1).IPAddress

Write-Host ""
if ($lanIP) {
    Write-Host "Server will be available at:"
    Write-Host "  http://127.0.0.1:3001   (this PC)"
    Write-Host "  http://${lanIP}:3001      (other PCs on the LAN)"
    Write-Host ""
    Write-Host "Configure client PCs: open WFM app → Server Setup → enter http://${lanIP}:3001"
} else {
    Write-Host "Could not detect LAN IP. Run 'ipconfig' to find it."
}
Write-Host ""
Write-Host "Press Ctrl+C to stop the server."
Write-Host ""

# Start the backend (using compiled JS if dist/ exists, otherwise ts-node-dev)
Set-Location $backendDir
$distIndex = Join-Path $backendDir "dist\index.js"
if (Test-Path $distIndex) {
    Write-Host "Starting: node dist/index.js"
    node dist/index.js
} else {
    Write-Host "Starting: npx ts-node-dev (development mode)"
    npx ts-node-dev --respawn --transpile-only src/index.ts
}
