#!/bin/sh
mac="$1"
[ -z "$mac" ] && exit 1

clientlocalif="br-guest"
GUEST_IFS=$(iw dev | grep Interface | cut -d' ' -f2)
for iface in $GUEST_IFS; do
    if iw dev "$iface" station get "$mac" >/dev/null 2>&1; then
        clientlocalif="$iface"
        break
    fi
done

printf "%s" "$clientlocalif"
exit 0
