#!/bin/bash
# ZGALAXY INFRASTRUCTURE ENGINE & CONSOLE - SERVER DEPLOYMENT SCRIPT
# Builds the web console, then starts the engine (TypeScript source) and the
# console with Bun. Override ports via ENGINE_PORT / CONSOLE_PORT env vars.

set -euo pipefail

echo "========================================================================"
echo "ZGALAXY INFRASTRUCTURE ENGINE & CONSOLE - SERVER DEPLOYMENT SCRIPT (Bun)"
echo "========================================================================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v bun &> /dev/null; then
    echo "[ERROR] Bun is not installed. Install it from https://bun.sh"
    exit 1
fi

ENGINE_PORT="${ENGINE_PORT:-3000}"
CONSOLE_PORT="${CONSOLE_PORT:-5173}"

echo "[1/3] Verifying engine dependencies..."
bun install --frozen-lockfile || exit 1

echo "[2/3] Building ZGalaxy SvelteKit Console Frontend (adapter-node)..."
cd web-console
bun install --frozen-lockfile || exit 1
bun run build || exit 1
cd ..

echo "[3/3] Starting ZGalaxy Server Services (Bun)..."
mkdir -p dist config zerotier-var
ENGINE_PORT="$ENGINE_PORT" bun run src/engine/server.ts > engine.log 2>&1 &
cd web-console
PORT="$CONSOLE_PORT" bun build/index.js > ../console.log 2>&1 &
cd ..

echo "========================================================================"
echo "ZGALAXY DEPLOYMENT COMPLETE!"
echo "Backend API  : http://localhost:${ENGINE_PORT} (Swagger: http://localhost:${ENGINE_PORT}/api/docs)"
echo "TUI Console  : http://localhost:${CONSOLE_PORT}"
echo "Logs         : engine.log, console.log"
echo "========================================================================"
