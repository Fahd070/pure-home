# WFM System — Windows Firewall Configuration
# Run once on the SERVER PC (as Administrator) to allow LAN access to the backend.
# Client PCs do NOT need this script.
#
# Usage:  Right-click PowerShell → Run as Administrator, then:
#         .\scripts\configure-firewall.ps1

#Requires -RunAsAdministrator

$ruleName = "WFM Backend (port 3001)"
$port     = 3001

# Remove any existing rule with the same name to avoid duplicates
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Remove-NetFirewallRule -DisplayName $ruleName
    Write-Host "Removed existing rule: $ruleName"
}

# Allow inbound TCP on port 3001 from the local network only
# Scope: restrict to private profile (LAN) and deny from internet (public profile)
New-NetFirewallRule `
    -DisplayName  $ruleName `
    -Direction    Inbound `
    -Protocol     TCP `
    -LocalPort    $port `
    -Action       Allow `
    -Profile      Private `
    -Description  "Allows WFM employee workstations on the LAN to reach the backend API and Socket.io" | Out-Null

Write-Host ""
Write-Host "Firewall rule created: '$ruleName'"
Write-Host "  Port   : $port (TCP, inbound)"
Write-Host "  Profile: Private (LAN only — internet connections are NOT allowed)"
Write-Host ""

# Print the machine's LAN IP so the admin knows what to configure on client PCs
$lanIP = (Get-NetIPAddress -AddressFamily IPv4 |
          Where-Object { $_.PrefixOrigin -eq "Dhcp" -or $_.PrefixOrigin -eq "Manual" } |
          Where-Object { $_.IPAddress -notlike "127.*" } |
          Select-Object -First 1).IPAddress

if ($lanIP) {
    Write-Host "This PC's LAN IP address: $lanIP"
    Write-Host "Configure client PCs to use: http://${lanIP}:${port}"
} else {
    Write-Host "Could not detect LAN IP automatically. Run: ipconfig"
}
Write-Host ""
