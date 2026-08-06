#!/bin/sh

# ZGALAXY container entrypoint.
# Starts ZeroTier, the ZGalaxy engine (Bun), and the web console (adapter-node).
# Ends with `wait` so the container stays alive (PID 1 must not exit).

set -x

ZT_BIN="/usr/sbin/zerotier-one"
ZT_PORT="${ZT_PORT:-9994}"
ENGINE_PORT="${ENGINE_PORT:-3000}"
CONSOLE_PORT="${CONSOLE_PORT:-5173}"

start() {
    echo "starting planet-moon engine, zerotier, and web console (Bun)"

    # zerotier-one runs in the foreground as the supervising process.
    "${ZT_BIN}" -p"$(cat /app/config/zerotier-one.port)" -d || exit 1

    ENGINE_PORT="${ENGINE_PORT}" nohup bun run /app/src/engine/server.ts &> /app/engine.log &

    if [ -f /app/web-console/build/index.js ]; then
        PORT="${CONSOLE_PORT}" nohup bun /app/web-console/build/index.js &> /app/console.log &
    else
        echo "[WARN] /app/web-console/build not found; console not started"
    fi
}

check_file_server() {
    if [ ! -f "/app/config/file_server.port" ]; then
        echo "${FILE_SERVER_PORT}" >/app/config/file_server.port
        echo "file_server.port = ${FILE_SERVER_PORT}"
    else
        echo "file_server.port exists, reading it"
        FILE_SERVER_PORT=$(cat /app/config/file_server.port)
        echo "file_server.port = ${FILE_SERVER_PORT}"
    fi
}

check_zerotier() {
    mkdir -p /var/lib/zerotier-one
    if [ "$(ls -A /var/lib/zerotier-one)" ]; then
        echo "/var/lib/zerotier-one is not empty, start directly"
        return 0
    fi

    mkdir -p /app/config
    echo "${ZT_PORT}" >/app/config/zerotier-one.port
    cp -r /bak/zerotier-one/* /var/lib/zerotier-one/ 2>/dev/null || true

    cd /var/lib/zerotier-one
    openssl rand -hex 16 > authtoken.secret

    zerotier-idtool generate identity.secret identity.public || exit 1
    zerotier-idtool initmoon identity.public > moon.json || exit 1

    if [ -z "$IP_ADDR4" ]; then IP_ADDR4=$(curl -s --max-time 10 https://ipv4.icanhazip.com/); fi
    if [ -z "$IP_ADDR6" ]; then IP_ADDR6=$(curl -s --max-time 10 https://ipv6.icanhazip.com/); fi

    echo "IP_ADDR4=$IP_ADDR4"
    echo "IP_ADDR6=$IP_ADDR6"

    ZT_PORT=$(cat /app/config/zerotier-one.port)

    if [ -z "$IP_ADDR4" ] && [ -n "$IP_ADDR6" ]; then
        stableEndpoints="[\"$IP_ADDR6/${ZT_PORT}\"]"
    elif [ -z "$IP_ADDR6" ] && [ -n "$IP_ADDR4" ]; then
        stableEndpoints="[\"$IP_ADDR4/${ZT_PORT}\"]"
    elif [ -n "$IP_ADDR4" ] && [ -n "$IP_ADDR6" ]; then
        stableEndpoints="[\"$IP_ADDR4/${ZT_PORT}\",\"$IP_ADDR6/${ZT_PORT}\"]"
    else
        echo "IP_ADDR4 and IP_ADDR6 are both empty!"
        exit 1
    fi

    echo "$IP_ADDR4" >/app/config/ip_addr4
    echo "$IP_ADDR6" >/app/config/ip_addr6

    jq --argjson newEndpoints "$stableEndpoints" '.roots[0].stableEndpoints = $newEndpoints' moon.json > temp.json && mv temp.json moon.json
    zerotier-idtool genmoon moon.json && mkdir -p moons.d && cp ./*.moon ./moons.d

    cp /app/mkmoonworld-x86_64 ./mkmoonworld-x86_64
    chmod +x ./mkmoonworld-x86_64
    ./mkmoonworld-x86_64 moon.json
    if [ $? -ne 0 ]; then
        echo "mkmoonworld failed!"
        exit 1
    fi

    mkdir -p /app/dist/
    mv world.bin /app/dist/planet
    cp ./*.moon /app/dist/
    echo "mkmoonworld success!"
}

check_file_server
check_zerotier

start

# Keep the container alive and reap child processes.
wait
