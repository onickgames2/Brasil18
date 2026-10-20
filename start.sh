#!/bin/sh

echo "🇧🇷 Iniciando BRASIL17..."

# Porta pública do Render (o Next.js usa esta)
PUBLIC_PORT="${PORT:-10000}"
# Porta interna do backend ASP.NET
BACKEND_PORT=5000

# Frontend (Next.js) na porta pública
cd /app/Frontend || exit 1
PORT="$PUBLIC_PORT" npm run start -- --hostname 0.0.0.0 --port "$PUBLIC_PORT" &
FRONTEND_PID=$!

# Backend (ASP.NET) na porta interna
cd /app || exit 1
PORT="$BACKEND_PORT" \
ASPNETCORE_URLS="http://0.0.0.0:$BACKEND_PORT" \
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
