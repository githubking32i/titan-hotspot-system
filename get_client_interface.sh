#!/bin/sh
mac="$1"
[ -z "$mac" ] && exit 1

clientlocalif="br-guest"
for iface in phy0-ap1 phy1-ap1; do
    if iw dev "$iface" station get "$mac" >/dev/null 2>&1; then
        clientlocalif="$iface"
        break
    fi
done

printf "%s" "$clientlocalif"
exit 0
