#!/bin/sh

echo "🇧🇷 Iniciando BRASIL17..."

# Porta pública do Render: quem usa é o BACKEND (ele faz proxy pro Next)
PUBLIC_PORT="${PORT:-10000}"
# Porta interna do Next.js (precisa ser a mesma do FrontendProxyMiddleware)
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

# Frontend (Next.js) na porta interna
cd /app/Frontend || exit 1
PORT="$FRONTEND_PORT" npm run start -- --hostname 0.0.0.0 --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

# Backend (ASP.NET) na porta pública
cd /app || exit 1
unset ASPNETCORE_HTTP_PORTS
ASPNETCORE_URLS="http://0.0.0.0:$PUBLIC_PORT" dotnet Roblox.Website.dll &
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
