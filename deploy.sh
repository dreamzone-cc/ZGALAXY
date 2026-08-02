#!/bin/bash

echo "========================================================================"
echo "ZGALAXY INFRASTRUCTURE ENGINE & CONSOLE - SERVER DEPLOYMENT SCRIPT"
echo "========================================================================"

# 1. Check Node.js and NPM
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed. Please install Node.js (v18+)."
    exit 1
fi

echo "[1/4] Building ZGalaxy Engine Backend..."
npm run build || exit 1

echo "[2/4] Building ZGalaxy SvelteKit Console Frontend..."
cd web-console
npm run build || exit 1
cd ..

echo "[3/4] Ensuring runtime directories exist..."
mkdir -p dist config zerotier-var

echo "[4/4] Starting ZGalaxy Server Services..."
nohup node dist_engine/engine/server.js > engine.log 2>&1 &
cd web-console
nohup npx vite dev --host --port 5173 > frontend.log 2>&1 &
cd ..

echo "========================================================================"
echo "ZGALAXY DEPLOYMENT COMPLETE!"
echo "Backend API  : http://localhost:3000 (Swagger: http://localhost:3000/api/docs)"
echo "TUI Console  : http://localhost:5173"
echo "========================================================================"
