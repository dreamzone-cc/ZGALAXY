#!/bin/bash
# Starts the ZGalaxy Engine and Web Console with Bun (default runtime).
# Engine runs directly from TypeScript source (no build required).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v bun &> /dev/null; then
    echo "[ERROR] Bun is not installed. Install it from https://bun.sh"
    exit 1
fi

echo "Starting ZeroTier Planet/Moon Infrastructure Engine & Web Console (Bun)..."

ENGINE_PORT="${ENGINE_PORT:-3000}"
CONSOLE_PORT="${CONSOLE_PORT:-5173}"

# Engine: run TypeScript source directly with Bun
ENGINE_PORT="$ENGINE_PORT" bun run src/engine/server.ts > "$SCRIPT_DIR/engine.log" 2>&1 &

# Web console: serve the adapter-node production build with Bun
if [ -d "$SCRIPT_DIR/web-console/build" ]; then
    cd "$SCRIPT_DIR/web-console"
    PORT="$CONSOLE_PORT" bun build/index.js > "$SCRIPT_DIR/console.log" 2>&1 &
else
    echo "[WARN] web-console/build not found. Run 'bun run build' in web-console first."
fi

echo "Services launched successfully!"
echo "Backend API  : http://localhost:${ENGINE_PORT}"
echo "TUI Console  : http://localhost:${CONSOLE_PORT}"
