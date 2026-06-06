# WFM System — Set Static LAN IP on the Server PC
# Run once on the SERVER PC (as Administrator).
# This prevents the server's IP from changing after a router restart.
#
# Usage:  Right-click PowerShell → Run as Administrator, then:
#         .\scripts\set-static-ip.ps1
#
# The script reads the current DHCP configuration and converts it to static
# using the same IP the router assigned. Edit $staticIP below to use a
# different address (recommended: pick an IP outside the DHCP range).

#Requires -RunAsAdministrator

# ─── CONFIGURATION ────────────────────────────────────────────────────────────
# Leave $staticIP empty to auto-detect and use the current IP.
# Or set it explicitly, e.g. "192.168.1.100"
$staticIP   = ""
$prefixLen  = 24          # 24 = /24 = 255.255.255.0 (most home/office routers)
$gateway    = ""          # Leave empty to auto-detect from current route
$dnsServers = @("8.8.8.8", "8.8.4.4")   # Google DNS — change if your ISP requires specific DNS
# ──────────────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=== WFM System — Static IP Configuration ==="
Write-Host ""

# Find the active network adapter (first connected, non-loopback, IPv4)
$adapter = Get-NetAdapter | Where-Object { $_.Status -eq "Up" -and $_.Name -notlike "*Loopback*" } | Select-Object -First 1
if (-not $adapter) {
    Write-Error "No active network adapter found. Connect to the LAN and retry."
    exit 1
}
Write-Host "Adapter: $($adapter.Name) ($($adapter.InterfaceDescription))"

# Get current IP config
$ipConfig = Get-NetIPAddress -InterfaceIndex $adapter.InterfaceIndex -AddressFamily IPv4 |
            Where-Object { $_.IPAddress -notlike "169.*" } | Select-Object -First 1

$routeConfig = Get-NetRoute -InterfaceIndex $adapter.InterfaceIndex -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $ipConfig) {
    Write-Error "Could not read current IPv4 configuration."
    exit 1
}

# Apply defaults from current config if not overridden
if (-not $staticIP) { $staticIP = $ipConfig.IPAddress }
if (-not $gateway)  { $gateway  = $routeConfig.NextHop }
if (-not $prefixLen){ $prefixLen = $ipConfig.PrefixLength }

Write-Host ""
Write-Host "Current IP : $($ipConfig.IPAddress) ($(if ($ipConfig.PrefixOrigin -eq 'Dhcp') {'DHCP'} else {'Static'}))"
Write-Host "Will set   : $staticIP / $prefixLen"
Write-Host "Gateway    : $gateway"
Write-Host "DNS        : $($dnsServers -join ', ')"
Write-Host ""
$confirm = Read-Host "Proceed? (y/n)"
if ($confirm -ne "y") { Write-Host "Cancelled."; exit 0 }

# Remove existing IP config (DHCP and any old static)
Remove-NetIPAddress    -InterfaceIndex $adapter.InterfaceIndex -Confirm:$false -ErrorAction SilentlyContinue
Remove-NetRoute        -InterfaceIndex $adapter.InterfaceIndex -Confirm:$false -ErrorAction SilentlyContinue

# Set static IP
New-NetIPAddress `
    -InterfaceIndex $adapter.InterfaceIndex `
    -IPAddress      $staticIP `
    -PrefixLength   $prefixLen `
    -DefaultGateway $gateway | Out-Null

# Set DNS
Set-DnsClientServerAddress -InterfaceIndex $adapter.InterfaceIndex -ServerAddresses $dnsServers

Write-Host ""
Write-Host "Static IP configured:"
Write-Host "  IP      : $staticIP"
Write-Host "  Prefix  : /$prefixLen"
Write-Host "  Gateway : $gateway"
Write-Host "  DNS     : $($dnsServers -join ', ')"
Write-Host ""
Write-Host "Configure client PCs to use: http://${staticIP}:3001"
Write-Host ""
Write-Host "To verify: ping $staticIP from another PC on the network."
Write-Host "To revert: set adapter back to 'Obtain IP automatically' in Network Settings."
Write-Host ""
