#!/bin/sh
# TITAN HOTSPOT - Router Activation, Usage Heartbeat & Expiry Daemon
# Location: /usr/bin/titan-hotspot-daemon.sh

# -------------------------------------------------------------
# Configuration: Set these to match your Cloudflare deployment
# -------------------------------------------------------------
WORKER_URL="${HOTSPOT_WORKER_URL:-https://YOUR_SUBDOMAIN.workers.dev}"
ROUTER_SECRET="${HOTSPOT_ROUTER_SECRET:-YOUR_ROUTER_SECRET_TOKEN}"
PORTAL_DOMAIN=$(echo "$WORKER_URL" | sed -e 's|^[^/]*//||' -e 's|/.*$||')
LOG_TAG="titan-hotspot"
HEARTBEAT_INTERVAL=30

logger -t "$LOG_TAG" "Titan Hotspot Activation & Usage Accounting Daemon started"

sync_walled_garden() {
    if nft list set ip nds_filter walledgarden >/dev/null 2>&1; then
        for ip in $(nslookup "$PORTAL_DOMAIN" 1.1.1.1 2>/dev/null | grep Address | awk '{print $2}' | grep -E '^[0-9]'); do
            nft add element ip nds_filter walledgarden { "$ip" } 2>/dev/null
        done
        for ip in $(nslookup api.qrserver.com 1.1.1.1 2>/dev/null | grep Address | awk '{print $2}' | grep -E '^[0-9]'); do
            nft add element ip nds_filter walledgarden { "$ip" } 2>/dev/null
        done
    fi
}

sync_walled_garden

LOOP_COUNT=0
HEARTBEAT_COUNTER=0

while true; do
    LOOP_COUNT=$((LOOP_COUNT + 1))
    HEARTBEAT_COUNTER=$((HEARTBEAT_COUNTER + 1))

    # Walled garden sync every ~60 seconds (12 loops x 5s)
    if [ "$LOOP_COUNT" -ge 12 ]; then
        sync_walled_garden
        LOOP_COUNT=0
    fi

    # 1. Fetch pending approvals from Cloudflare Worker
    RESP=$(curl -s -m 5 -H "X-Router-Secret: $ROUTER_SECRET" "$WORKER_URL/api/router/pending-auth")
    
    if [ -n "$RESP" ] && [ "$RESP" != "[]" ] && echo "$RESP" | grep -q '"id"'; then
        if command -v jsonfilter >/dev/null 2>&1; then
            echo "$RESP" | jsonfilter -e '@[*]' | while read -r P; do
                PID=$(echo "$P" | jsonfilter -e '@.id')
                MAC=$(echo "$P" | jsonfilter -e '@.client_mac')
                IP=$(echo "$P" | jsonfilter -e '@.client_ip')
                DUR=$(echo "$P" | jsonfilter -e '@.duration_minutes')
                
                [ -z "$DUR" ] && DUR=120
                
                logger -t "$LOG_TAG" "Authorizing approved payment $PID for MAC=$MAC IP=$IP duration=${DUR}m"
                
                AUTH_OK=0
                if [ -n "$MAC" ] && [ "$MAC" != "-" ]; then
                    ndsctl auth "$MAC" "$DUR" >/dev/null 2>&1 && AUTH_OK=1
                fi
                if [ "$AUTH_OK" -eq 0 ] && [ -n "$IP" ]; then
                    ndsctl auth "$IP" "$DUR" >/dev/null 2>&1 && AUTH_OK=1
                fi
                if [ "$AUTH_OK" -eq 0 ] && [ -n "$MAC" ]; then
                    if ndsctl json 2>/dev/null | grep -iq "$MAC"; then
                        AUTH_OK=1
                    fi
                fi
                
                if [ "$AUTH_OK" -eq 1 ]; then
                    logger -t "$LOG_TAG" "Authorized client $MAC / $IP"
                    curl -s -m 5 -X POST \
                        -H "Content-Type: application/json" \
                        -H "X-Router-Secret: $ROUTER_SECRET" \
                        -d "{\"payment_id\":\"$PID\",\"duration_minutes\":$DUR}" \
                        "$WORKER_URL/api/router/ack-auth" >/dev/null 2>&1
                else
                    logger -t "$LOG_TAG" "Failed to authorize $MAC / $IP in OpenNDS (retrying next cycle)"
                fi
            done
        fi
    fi

    # 1.5 Fetch pending remote commands from Cloudflare Worker
    CMD_RESP=$(curl -s -m 5 -H "X-Router-Secret: $ROUTER_SECRET" "$WORKER_URL/api/router/pending-commands")
    if [ -n "$CMD_RESP" ] && [ "$CMD_RESP" != "[]" ] && echo "$CMD_RESP" | grep -q '"id"'; then
        if command -v jsonfilter >/dev/null 2>&1; then
            echo "$CMD_RESP" | jsonfilter -e '@[*]' | while read -r CMD; do
                CID=$(echo "$CMD" | jsonfilter -e '@.id')
                ACT=$(echo "$CMD" | jsonfilter -e '@.action')
                CMAC=$(echo "$CMD" | jsonfilter -e '@.mac')
                CMIN=$(echo "$CMD" | jsonfilter -e '@.minutes')

                logger -t "$LOG_TAG" "Executing remote admin command $CID action=$ACT mac=$CMAC minutes=$CMIN"

                if [ "$ACT" = "auth" ] && [ -n "$CMAC" ]; then
                    [ -z "$CMIN" ] && CMIN=120
                    ndsctl auth "$CMAC" "$CMIN" >/dev/null 2>&1
                elif [ "$ACT" = "deauth" ] && [ -n "$CMAC" ]; then
                    ndsctl deauth "$CMAC" >/dev/null 2>&1
                elif [ "$ACT" = "restart_nds" ]; then
                    /etc/init.d/opennds restart >/dev/null 2>&1 &
                elif [ "$ACT" = "restart_daemon" ]; then
                    curl -s -m 5 -X POST -H "Content-Type: application/json" -H "X-Router-Secret: $ROUTER_SECRET" -d "{\"command_id\":\"$CID\",\"status\":\"executed\"}" "$WORKER_URL/api/router/ack-command" >/dev/null 2>&1
                    /etc/init.d/titan-hotspot restart &
                    continue
                fi

                curl -s -m 5 -X POST -H "Content-Type: application/json" -H "X-Router-Secret: $ROUTER_SECRET" -d "{\"command_id\":\"$CID\",\"status\":\"executed\"}" "$WORKER_URL/api/router/ack-command" >/dev/null 2>&1
            done
        fi
    fi

    # 2. Usage Heartbeat: Every 30 seconds (6 loops x 5s)
    # Only charges time for clients that are actively associated with Wi-Fi and authenticated
    if [ "$HEARTBEAT_COUNTER" -ge 6 ]; then
        HEARTBEAT_COUNTER=0
        
        CLIENTS_JSON="["
        FIRST=1
        
        # Check active stations connected to both 2.4GHz (phy0-ap1) and 5GHz (phy1-ap1)
        ACTIVE_MACS=$(for IF in phy0-ap1 phy1-ap1; do iw dev "$IF" station dump 2>/dev/null | grep -i Station | cut -d' ' -f2; done | sort -u)
        for ST_MAC in $ACTIVE_MACS; do
            if [ -n "$ST_MAC" ]; then
                # Check if station is authenticated in OpenNDS
                if ndsctl json 2>/dev/null | grep -iq "$ST_MAC"; then
                    if [ "$FIRST" -eq 1 ]; then
                        CLIENTS_JSON="$CLIENTS_JSON{\"mac\":\"$ST_MAC\"}"
                        FIRST=0
                    else
                        CLIENTS_JSON="$CLIENTS_JSON,{\"mac\":\"$ST_MAC\"}"
                    fi
                fi
            fi
        done
        CLIENTS_JSON="$CLIENTS_JSON]"

        UPTIME=$(uptime | awk -F',  ' '{print $1}' | awk '{print $3,$4}' | sed 's/[^a-zA-Z0-9: ]//g')
        LOAD=$(uptime | awk -F'load average:' '{print $2}' | sed 's/^[ \t]*//' | sed 's/[^0-9., ]//g')
        NDS_JSON=$(ndsctl json 2>/dev/null)
        [ -z "$NDS_JSON" ] && NDS_JSON="{}"

        HB_BODY="{\"connected_clients\":$CLIENTS_JSON,\"interval_seconds\":$HEARTBEAT_INTERVAL,\"uptime\":\"$UPTIME\",\"load\":\"$LOAD\",\"nds_clients\":$NDS_JSON}"

        # Send heartbeat to Cloudflare Worker
        HB_RESP=$(curl -s -m 5 -X POST \
            -H "Content-Type: application/json" \
            -H "X-Router-Secret: $ROUTER_SECRET" \
            -d "$HB_BODY" \
            "$WORKER_URL/api/router/heartbeat")

        # Check if any clients expired and need immediate deauth
        if [ -n "$HB_RESP" ] && echo "$HB_RESP" | grep -q '"deauth_macs"'; then
            if command -v jsonfilter >/dev/null 2>&1; then
                for DMAC in $(echo "$HB_RESP" | jsonfilter -e '@.deauth_macs[*]'); do
                    if [ -n "$DMAC" ]; then
                        logger -t "$LOG_TAG" "Deauthenticating expired client MAC=$DMAC"
                        ndsctl deauth "$DMAC" >/dev/null 2>&1
                    fi
                done
            fi
        fi
    fi

    sleep 5
done
