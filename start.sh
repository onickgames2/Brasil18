#!/bin/sh

echo "🇧🇷 Iniciando BRASIL17..."

cd /app/Frontend || exit 1

npm run start -- --hostname 0.0.0.0 &
FRONTEND_PID=$!

cd /app || exit 1

dotnet Roblox.Website.dll &
BACKEND_PID=$!

terminate() {
    kill "$FRONTEND_PID" "$BACKEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
}

trap terminate TERM INT

while kill -0 "$FRONTEND_PID" 2>/dev/null &&
      kill -0 "$BACKEND_PID" 2>/dev/null
do
    sleep 2
done

terminate
exit 1
