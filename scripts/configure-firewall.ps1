# WFM System - Windows Firewall Configuration for Tailscale
# Run once on the SERVER PC (as Administrator).
# Opens port 3001 for employee machines connecting via Tailscale.
# Client PCs do NOT need this script.
#
# Usage:  Right-click PowerShell -> Run as Administrator, then:
#         .\scripts\configure-firewall.ps1

#Requires -RunAsAdministrator

$ruleNameTailscale = "WFM Backend - Tailscale (port 3001)"
$ruleNameLAN       = "WFM Backend - LAN fallback (port 3001)"
$port              = 3001

Write-Host ""
Write-Host "=== WFM System - Firewall Configuration (Tailscale) ==="
Write-Host ""

# --- Rule 1: Tailscale CGNAT range (100.64.0.0/10) ---
# Tailscale assigns each machine an IP in 100.64.x.x - 100.127.x.x.
# We allow inbound TCP 3001 from this range so all tailnet members can connect.

$existing = Get-NetFirewallRule -DisplayName $ruleNameTailscale -ErrorAction SilentlyContinue
if ($existing) {
    Remove-NetFirewallRule -DisplayName $ruleNameTailscale
    Write-Host "Replaced existing Tailscale rule."
}

New-NetFirewallRule `
    -DisplayName  $ruleNameTailscale `
    -Direction    Inbound `
    -Protocol     TCP `
    -LocalPort    $port `
    -RemoteAddress "100.64.0.0/10" `
    -Action       Allow `
    -Profile      Any `
    -Description  "Allows WFM employee PCs on the Tailscale network to reach the backend API and Socket.io" | Out-Null

Write-Host "Firewall rule created: '$ruleNameTailscale'"
Write-Host "  Port        : $port (TCP, inbound)"
Write-Host "  Remote range: 100.64.0.0/10 (Tailscale CGNAT)"
Write-Host "  Profile     : Any (required - Tailscale adapter may show as Public)"
Write-Host ""

# --- Rule 2: LAN fallback (Private profile only) ---
# Optional - useful if the admin also uses the server PC on the same LAN
# without Tailscale configured on that specific machine.

$existing2 = Get-NetFirewallRule -DisplayName $ruleNameLAN -ErrorAction SilentlyContinue
if ($existing2) {
    Remove-NetFirewallRule -DisplayName $ruleNameLAN
}

New-NetFirewallRule `
    -DisplayName  $ruleNameLAN `
    -Direction    Inbound `
    -Protocol     TCP `
    -LocalPort    $port `
    -Action       Allow `
    -Profile      Private `
    -Description  "Allows local LAN access to WFM backend (Private network only)" | Out-Null

Write-Host "Firewall rule created: '$ruleNameLAN'"
Write-Host "  Port   : $port (TCP, inbound)"
Write-Host "  Profile: Private (LAN only)"
Write-Host ""

# --- Print Tailscale IP ---

$tailscaleIP = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                Where-Object {
                    $o = [int]($_.IPAddress.Split('.')[1])
                    $_.IPAddress.Split('.')[0] -eq '100' -and $o -ge 64 -and $o -le 127
                } | Select-Object -First 1).IPAddress

if ($tailscaleIP) {
    Write-Host "This PC's Tailscale IP: $tailscaleIP"
    Write-Host "Configure client PCs: http://${tailscaleIP}:${port}"
} else {
    Write-Host "Tailscale IP not detected on this PC."
    Write-Host "Install Tailscale from https://tailscale.com/download and run: tailscale up"
    Write-Host "Then re-run this script to confirm the IP."
}

# Also print LAN IP for reference
$lanIP = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
          Where-Object { $_.PrefixOrigin -in @("Dhcp","Manual") -and $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "100.*" } |
          Select-Object -First 1).IPAddress

if ($lanIP) {
    Write-Host ""
    Write-Host "LAN IP (for reference): $lanIP"
}
Write-Host ""
Write-Host "Done. Employees must have Tailscale installed and connected to the same tailnet."
Write-Host ""
