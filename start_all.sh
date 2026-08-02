#!/bin/bash
echo "Starting ZeroTier Planet/Moon Infrastructure Engine & SvelteKit TUI Console..."

cd /home/ggonlinux/zt/docker-zerotier-planet-2.0.5
node dist_engine/engine/server.js > /home/ggonlinux/zt/docker-zerotier-planet-2.0.5/engine.log 2>&1 &

cd /home/ggonlinux/zt/docker-zerotier-planet-2.0.5/web-console
npx vite dev --host --port 5173 > /home/ggonlinux/zt/docker-zerotier-planet-2.0.5/web-console/frontend.log 2>&1 &

echo "Services launched successfully!"
