#!/bin/sh

set -m

echo "🇧🇷 Iniciando BRASIL17..."

cd /app/Frontend
npm run start -- --hostname 0.0.0.0 &
FRONTEND_PID=$!

cd /app
dotnet Roblox.Website.dll &
BACKEND_PID=$!

terminate() {
    kill "$FRONTEND_PID" "$BACKEND_PID" 2>/dev/null || true
    wait
}

trap terminate TERM INT

wait -n "$FRONTEND_PID" "$BACKEND_PID"
STATUS=$?

terminate
exit "$STATUS"
