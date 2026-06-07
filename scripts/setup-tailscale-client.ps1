# WFM System - Tailscale Setup for Employee PCs
# Run once on each employee PC (as Administrator).
#
# HOW TO USE
# ----------
# Preferred (auth key - no browser required):
#   .\setup-tailscale-client.ps1 -AuthKey "tskey-auth-xxxxxxxxxxxx" -ServerIP "100.97.118.118"
#
# Interactive (browser login):
#   .\setup-tailscale-client.ps1 -ServerIP "100.97.118.118"
#
# If you see "authentication link could not be located":
#   The one-time browser URL expired (it is only valid ~10 minutes).
#   Use an auth key instead -- generate one at:
#   https://login.tailscale.com/admin/settings/keys
#   Set it as Reusable so all employee PCs can use the same key.

param(
    [string]$ServerIP  = "",   # Tailscale IP of the WFM server (e.g. 100.97.118.118)
    [string]$AuthKey   = "",   # Pre-auth key from https://login.tailscale.com/admin/settings/keys
    [switch]$ForceReauth       # Force a clean re-authentication even if already connected
)

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== WFM System - Tailscale Setup (Employee PC) ==="
Write-Host ""

# --- Helper: get current Tailscale IP from network adapter ---
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

# --- Helper: find tailscale.exe ---
function Get-TailscaleExe {
    $searchPaths = @(
        "$env:ProgramFiles\Tailscale\tailscale.exe",
        "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe",
        "$env:LocalAppData\Tailscale\tailscale.exe"
    )
    foreach ($p in $searchPaths) {
        if (Test-Path $p) { return $p }
    }
    try { return (Get-Command tailscale.exe -ErrorAction Stop).Source } catch {}
    return $null
}

# --- Step 1: Install Tailscale if missing ---
Write-Host "Step 1: Checking Tailscale installation..."
$tailscaleExe = Get-TailscaleExe

if (-not $tailscaleExe) {
    Write-Host "  Tailscale not installed. Downloading now..."
    $installerUrl  = "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"
    $installerPath = "$env:TEMP\tailscale-setup.exe"
    try {
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
        Write-Host "  Download complete. Running installer (follow the prompts)..."
        Start-Process -FilePath $installerPath -Wait
        Start-Sleep -Seconds 3
        $tailscaleExe = Get-TailscaleExe
    } catch {
        Write-Host ""
        Write-Host "  Automatic download failed."
        Write-Host "  Install Tailscale manually from: https://tailscale.com/download/windows"
        Write-Host "  Then re-run this script."
        exit 1
    }
    if (-not $tailscaleExe) {
        Write-Host "  Could not locate tailscale.exe after installation."
        Write-Host "  Open a new Admin PowerShell window and re-run this script."
        exit 1
    }
}
Write-Host "  Found: $tailscaleExe"

# --- Step 2: Ensure Tailscale service is running ---
Write-Host ""
Write-Host "Step 2: Ensuring Tailscale service is running..."
$svc = Get-Service -Name "Tailscale" -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "  Tailscale service not found. Starting daemon manually..."
    Start-Process -FilePath $tailscaleExe -ArgumentList "/service" -WindowStyle Hidden -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
} elseif ($svc.Status -ne "Running") {
    Write-Host "  Starting Tailscale service..."
    Start-Service -Name "Tailscale" -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
} else {
    Write-Host "  Tailscale service is running."
}

# Set service to auto-start
$svc = Get-Service -Name "Tailscale" -ErrorAction SilentlyContinue
if ($svc -and $svc.StartType -ne "Automatic") {
    Set-Service -Name "Tailscale" -StartupType Automatic
    Write-Host "  Tailscale service set to Automatic startup."
}

# --- Step 3: Logout / reset stale state if ForceReauth is set ---
if ($ForceReauth) {
    Write-Host ""
    Write-Host "Step 3: Clearing stale Tailscale state (ForceReauth)..."
    & $tailscaleExe logout 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    Write-Host "  Previous session cleared."
}

# --- Step 4: Authenticate ---
Write-Host ""
$myTailscaleIP = Get-TailscaleIP

if ($myTailscaleIP -and -not $ForceReauth) {
    Write-Host "Step 4: Already connected to Tailscale."
    Write-Host "  This PC's Tailscale IP: $myTailscaleIP"
} elseif ($AuthKey -ne "") {
    # --- Auth key method (preferred for production) ---
    Write-Host "Step 4: Authenticating with auth key (no browser required)..."
    Write-Host "  Running: tailscale up --authkey <key>"
    $result = & $tailscaleExe up --authkey $AuthKey --reset 2>&1
    if ($result) { Write-Host "  $result" }
    Start-Sleep -Seconds 5
    $myTailscaleIP = Get-TailscaleIP
    if ($myTailscaleIP) {
        Write-Host "  Connected! This PC's Tailscale IP: $myTailscaleIP"
    } else {
        Write-Host ""
        Write-Host "  Auth key login did not produce an IP within 5 seconds."
        Write-Host "  Check that the key is valid and not expired:"
        Write-Host "    https://login.tailscale.com/admin/settings/keys"
        Write-Host "  Then re-run: .\setup-tailscale-client.ps1 -AuthKey <new-key> -ServerIP $ServerIP"
        exit 1
    }
} else {
    # --- Browser auth method (interactive) ---
    Write-Host "Step 4: Browser-based authentication."
    Write-Host ""
    Write-Host "  IMPORTANT: The login link expires in ~10 minutes."
    Write-Host "  You must click it immediately when it appears."
    Write-Host ""
    Write-Host "  Generating fresh login URL..."

    # Force a fresh auth URL (avoids reusing a previously expired one)
    & $tailscaleExe logout 2>&1 | Out-Null
    Start-Sleep -Seconds 2

    # Capture the auth URL from tailscale up output
    $upOutput = & $tailscaleExe up --reset 2>&1
    $authUrl = ($upOutput | Select-String -Pattern "https://login\.tailscale\.com/a/\S+").Matches.Value

    if ($authUrl) {
        Write-Host ""
        Write-Host "  ============================================================"
        Write-Host "  OPEN THIS URL IN YOUR BROWSER NOW (expires in ~10 minutes):"
        Write-Host ""
        Write-Host "  $authUrl"
        Write-Host "  ============================================================"
        Write-Host ""
        # Try to open the browser automatically
        try { Start-Process $authUrl } catch {}
    } else {
        Write-Host "  Could not extract auth URL from tailscale output."
        Write-Host "  Opening Tailscale tray app - click 'Sign In' from the tray icon."
        $tailscaleUiExe = Join-Path (Split-Path $tailscaleExe) "tailscale-ipn.exe"
        if (-not (Test-Path $tailscaleUiExe)) { $tailscaleUiExe = $tailscaleExe }
        Start-Process $tailscaleUiExe -ErrorAction SilentlyContinue
    }

    Write-Host "  Waiting for browser login (up to 120 seconds)..."
    $waited = 0
    while ($waited -lt 120) {
        Start-Sleep -Seconds 5
        $waited += 5
        $myTailscaleIP = Get-TailscaleIP
        if ($myTailscaleIP) { break }
        Write-Host "  Waiting... ($waited s)"
    }

    if (-not $myTailscaleIP) {
        Write-Host ""
        Write-Host "  Tailscale did not connect within 120 seconds."
        Write-Host ""
        Write-Host "  To avoid this problem in the future, use an auth key:"
        Write-Host "    1. Go to: https://login.tailscale.com/admin/settings/keys"
        Write-Host "    2. Click 'Generate auth key'"
        Write-Host "    3. Enable 'Reusable' so all PCs can use the same key"
        Write-Host "    4. Copy the key and run:"
        Write-Host "       .\setup-tailscale-client.ps1 -AuthKey tskey-auth-xxxx -ServerIP $ServerIP"
        exit 1
    }

    Write-Host "  Connected! This PC's Tailscale IP: $myTailscaleIP"
}

# --- Step 5: Test connectivity to WFM backend server ---
Write-Host ""
Write-Host "Step 5: Testing connectivity to WFM backend server..."

if (-not $ServerIP) {
    Write-Host ""
    Write-Host "  Enter the WFM server Tailscale IP (e.g. 100.97.118.118)."
    Write-Host "  Ask your IT admin for this value, or check the server PC with: tailscale ip"
    Write-Host ""
    $ServerIP = Read-Host "  Server Tailscale IP"
}

$serverUrl = "http://${ServerIP}:3001"
Write-Host "  Testing: $serverUrl/health ..."

$connected = $false
try {
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add("User-Agent", "WFM-Setup/1.0")
    $json  = $wc.DownloadString("${serverUrl}/health")
    $body  = $json | ConvertFrom-Json
    if ($body.status -eq "ok") {
        Write-Host "  Backend reachable. Database: $($body.database)"
        $connected = $true
    } else {
        Write-Host "  Server responded but database status: $($body.database)"
        Write-Host "  Ask IT admin to check if PostgreSQL is running on the server PC."
    }
} catch {
    Write-Host "  Could not reach $serverUrl"
    Write-Host ""
    Write-Host "  Troubleshooting checklist:"
    Write-Host "    - Confirm the server Tailscale IP with IT admin"
    Write-Host "    - Check that the server PC is powered on"
    Write-Host "    - Check that Tailscale is running on the server: tailscale status"
    Write-Host "    - Test port: Test-NetConnection -ComputerName $ServerIP -Port 3001"
    Write-Host "    - On the server, confirm backend is running:"
    Write-Host "      Invoke-WebRequest http://127.0.0.1:3001/health"
}

# --- Summary ---
Write-Host ""
Write-Host "============================================================"
Write-Host " SETUP SUMMARY"
Write-Host "============================================================"
Write-Host "  This PC's Tailscale IP : $myTailscaleIP"
Write-Host "  WFM Server URL         : $serverUrl"
if ($connected) {
    Write-Host "  Backend connectivity   : OK"
    Write-Host ""
    Write-Host "  NEXT STEP - Configure WFM System app:"
    Write-Host "    1. Open WFM System"
    Write-Host "    2. Click 'Server Setup' on the department selection screen"
    Write-Host "    3. Enter: $serverUrl"
    Write-Host "    4. Click 'Test and Save'"
} else {
    Write-Host "  Backend connectivity   : FAILED (see troubleshooting above)"
}
Write-Host ""
