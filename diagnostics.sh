#!/bin/sh
# TITAN HOTSPOT - IMOU HX21 Diagnostics Script
# এই script SSH দিয়ে রাউটারে চালাও
# Usage: ssh root@<router-ip> 'sh -s' < diagnostics.sh

echo "============================================"
echo "  TITAN HOTSPOT - HX21 Diagnostics"
echo "============================================"

echo ""
echo "=== 1. Board Information ==="
ubus call system board 2>&1

echo ""
echo "=== 2. Package Manager Check ==="
echo -n "apk: "; command -v apk 2>/dev/null || echo "not found"
echo -n "opkg: "; command -v opkg 2>/dev/null || echo "not found"

echo ""
echo "=== 3. Network Devices ==="
ip -br link 2>&1

echo ""
echo "=== 4. IPv4 Addresses ==="
ip -br -4 addr 2>&1

echo ""
echo "=== 5. IPv4 Routes ==="
ip -4 route 2>&1

echo ""
echo "=== 6. WAN Status ==="
ubus call network.interface.wan status 2>&1 | head -50

echo ""
echo "=== 7. Network Interfaces (UCI) ==="
uci show network 2>&1

echo ""
echo "=== 8. Wireless Configuration (UCI) ==="
uci show wireless 2>&1

echo ""
echo "=== 9. Firewall Zones (UCI) ==="
uci show firewall 2>&1

echo ""
echo "=== 10. OpenNDS Version ==="
opennds -v 2>&1 || echo "opennds not found"

echo ""
echo "=== 11. OpenNDS Status ==="
ndsctl status 2>&1 || echo "ndsctl not available or opennds not running"

echo ""
echo "=== 12. OpenNDS Config (UCI) ==="
uci show opennds 2>&1 || echo "opennds UCI config not found"

echo ""
echo "=== 13. DHCP/DNSMasq Config ==="
uci show dhcp 2>&1

echo ""
echo "=== 14. Installed Packages (hotspot related) ==="
if command -v apk >/dev/null 2>&1; then
    echo "--- APK installed packages ---"
    apk list --installed 2>/dev/null | grep -iE "opennds|dnsmasq|nftables|curl|wget|ssl|ca-cert" 2>&1
elif command -v opkg >/dev/null 2>&1; then
    echo "--- OPKG installed packages ---"
    opkg list-installed 2>/dev/null | grep -iE "opennds|dnsmasq|nftables|curl|wget|ssl|ca-cert" 2>&1
fi

echo ""
echo "=== 15. Running Services ==="
ps | grep -E "opennds|dnsmasq|uhttpd|nginx" | grep -v grep 2>&1

echo ""
echo "=== 16. Disk Space ==="
df -h 2>&1

echo ""
echo "=== 17. Memory ==="
free -m 2>&1

echo ""
echo "=== 18. Internet Connectivity Test ==="
ping -c 2 -W 3 1.1.1.1 2>&1
echo "---"
ping -c 2 -W 3 google.com 2>&1

echo ""
echo "============================================"
echo "  Diagnostics Complete"
echo "============================================"
