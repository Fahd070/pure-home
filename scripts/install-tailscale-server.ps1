# WFM System - Tailscale Installation Guide for the Server PC
# Run once on the designated SERVER PC (as Administrator).
#
# This script:
#   1. Checks whether Tailscale is already installed and connected
#   2. Downloads and installs Tailscale if it is not present
#   3. Guides you through signing in and verifying the connection
#   4. Prints the Tailscale IP to share with employee PCs
#
# Usage:  Right-click PowerShell -> Run as Administrator, then:
#         .\scripts\install-tailscale-server.ps1

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== WFM System - Tailscale Setup (Server PC) ==="
Write-Host ""

# --- Helper: detect Tailscale IP ---
function Get-TailscaleIP {
    $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $parts = $_.IPAddress.Split('.')
            $parts.Count -eq 4 -and
            $parts[0] -eq '100' -and
            [int]$parts[1] -ge 64 -and [int]$parts[1] -le 127
        } | Select-Object -First 1
    return $addr.IPAddress
}

# --- 1. Check if Tailscale is installed ---
$tailscaleExe = $null
$searchPaths = @(
    "$env:ProgramFiles\Tailscale\tailscale.exe",
    "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe",
    "$env:LocalAppData\Tailscale\tailscale.exe"
)
foreach ($p in $searchPaths) {
    if (Test-Path $p) { $tailscaleExe = $p; break }
}

if (-not $tailscaleExe) {
    try { $tailscaleExe = (Get-Command tailscale.exe -ErrorAction Stop).Source } catch {}
}

if ($tailscaleExe) {
    Write-Host "Tailscale is installed: $tailscaleExe"
} else {
    Write-Host "Tailscale is NOT installed."
    Write-Host ""
    Write-Host "Downloading Tailscale installer..."
    $installerUrl  = "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"
    $installerPath = "$env:TEMP\tailscale-setup.exe"
    try {
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
        Write-Host "Download complete. Launching installer..."
        Write-Host "(Follow the prompts - use the default options)"
        Start-Process -FilePath $installerPath -Wait
        Write-Host ""
        Write-Host "Installation complete. Searching for tailscale.exe..."
        foreach ($p in $searchPaths) {
            if (Test-Path $p) { $tailscaleExe = $p; break }
        }
        if (-not $tailscaleExe) {
            try { $tailscaleExe = (Get-Command tailscale.exe -ErrorAction Stop).Source } catch {}
        }
        if (-not $tailscaleExe) {
            Write-Host "Could not locate tailscale.exe after installation."
            Write-Host "Open a NEW PowerShell window as Administrator and re-run this script."
            exit 1
        }
    } catch {
        Write-Host ""
        Write-Host "Automatic download failed. Please install Tailscale manually:"
        Write-Host "  https://tailscale.com/download/windows"
        Write-Host "Then re-run this script."
        exit 1
    }
}

# --- 2. Check if already connected ---
$tailscaleIP = Get-TailscaleIP

if ($tailscaleIP) {
    Write-Host ""
    Write-Host "Tailscale is already connected."
    Write-Host "  Server Tailscale IP: $tailscaleIP"
} else {
    Write-Host ""
    Write-Host "Tailscale is installed but not yet connected."
    Write-Host ""
    Write-Host "ACTION REQUIRED:"
    Write-Host "  1. The Tailscale icon should appear in your system tray (bottom-right)."
    Write-Host "  2. Click it and choose 'Sign In'."
    Write-Host "  3. Sign in with the company Tailscale account."
    Write-Host "     (All employees must use the SAME Tailscale account / organisation)"
    Write-Host "  4. After signing in, Tailscale will assign this PC a 100.x.x.x address."
    Write-Host ""

    # Try to open Tailscale UI
    try {
        $tailscaleUiExe = Join-Path (Split-Path $tailscaleExe) "tailscale-ipn.exe"
        if (-not (Test-Path $tailscaleUiExe)) {
            $tailscaleUiExe = Join-Path (Split-Path $tailscaleExe) "tailscale.exe"
        }
        Start-Process $tailscaleUiExe -ErrorAction SilentlyContinue
    } catch {}

    Write-Host "Waiting for Tailscale to connect (up to 120 seconds)..."
    $waited = 0
    while ($waited -lt 120) {
        Start-Sleep -Seconds 5
        $waited += 5
        $tailscaleIP = Get-TailscaleIP
        if ($tailscaleIP) {
            Write-Host "Connected! Tailscale IP: $tailscaleIP"
            break
        }
        Write-Host "  Still waiting... ($waited s)"
    }

    if (-not $tailscaleIP) {
        Write-Host ""
        Write-Host "Tailscale did not connect within 120 seconds."
        Write-Host "Please sign in manually via the Tailscale tray icon, then re-run this script."
        exit 1
    }
}

# --- 3. Enable Tailscale to start with Windows ---
Write-Host ""
Write-Host "Ensuring Tailscale service starts automatically..."
$svc = Get-Service -Name "Tailscale" -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.StartType -ne "Automatic") {
        Set-Service -Name "Tailscale" -StartupType Automatic
        Write-Host "  Tailscale service set to Automatic startup."
    } else {
        Write-Host "  Tailscale service is already set to Automatic startup."
    }
} else {
    Write-Host "  Tailscale service not found via Get-Service."
    Write-Host "  Tailscale manages its own startup - it should start automatically after login."
}

# --- 4. Summary ---
Write-Host ""
Write-Host "============================================================"
Write-Host " TAILSCALE SETUP COMPLETE"
Write-Host "============================================================"
Write-Host ""
Write-Host "  Server PC Tailscale IP: $tailscaleIP"
Write-Host ""
Write-Host "  Share this URL with all employees:"
Write-Host "    http://${tailscaleIP}:3001"
Write-Host ""
Write-Host "  NEXT STEPS:"
Write-Host "  1. Run .\scripts\configure-firewall.ps1  (allow port 3001 from tailnet)"
Write-Host "  2. Run .\scripts\install-autostart.ps1   (register backend as scheduled task)"
Write-Host "  3. On each employee PC, run:"
Write-Host "     .\scripts\setup-tailscale-client.ps1 -ServerIP $tailscaleIP"
Write-Host ""
Write-Host "  TIP - To avoid expired auth links on employee PCs, use an auth key:"
Write-Host "    1. Go to: https://login.tailscale.com/admin/settings/keys"
Write-Host "    2. Generate a Reusable auth key"
Write-Host "    3. Run on each employee PC:"
Write-Host "       .\scripts\setup-tailscale-client.ps1 -AuthKey tskey-auth-xxxx -ServerIP $tailscaleIP"
Write-Host ""
Write-Host "  The Tailscale IP (100.x.x.x) is STABLE - it does not change"
Write-Host "  even if the server PC restarts or the router changes."
Write-Host ""
