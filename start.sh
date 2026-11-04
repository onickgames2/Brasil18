#!/bin/sh

echo "🇧🇷 Iniciando BRASIL17..."

# Porta pública do Render: quem usa é o BACKEND (ele faz proxy pro Next)
PUBLIC_PORT="${PORT:-10000}"
# Porta interna do Next.js (precisa ser a mesma do FrontendProxyMiddleware)
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
# Porta interna do render server (o RenderingHandler usa localhost:7832 por padrão)
RENDER_PORT="${RENDER_PORT:-7832}"

FRONTEND_PID=""
RENDER_PID=""

# Backend (ASP.NET) primeiro, na porta pública
cd /app || exit 1
unset ASPNETCORE_HTTP_PORTS
ASPNETCORE_URLS="http://0.0.0.0:$PUBLIC_PORT" dotnet Roblox.Website.dll &
BACKEND_PID=$!

# Espera o backend responder antes de abrir as outras portas,
# senão o Render pode escolher a porta errada como principal.
echo "⏳ Aguardando o backend..."
WAITED=0
until curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PUBLIC_PORT/"; do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo "❌ O backend caiu ao iniciar. Veja o erro acima."
        exit 1
    fi
    WAITED=$((WAITED + 2))
    if [ "$WAITED" -ge 300 ]; then
        echo "❌ O backend não subiu em 5 minutos."
        exit 1
    fi
    sleep 2
done
echo "✅ Backend no ar."

# Frontend (Next.js) na porta interna
cd /app/Frontend || exit 1
PORT="$FRONTEND_PORT" npm run start -- --hostname 0.0.0.0 --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

# Render server (three.js + Chromium) na porta interna
start_render() {
    cd /app/render-server || return 1
    RENDER_PORT="$RENDER_PORT" node server.js &
    RENDER_PID=$!
    cd /app || return 1
}
start_render

terminate() {
    kill "$FRONTEND_PID" "$BACKEND_PID" "$RENDER_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
    wait "$RENDER_PID" 2>/dev/null || true
}

trap terminate TERM INT

while kill -0 "$FRONTEND_PID" 2>/dev/null &&
      kill -0 "$BACKEND_PID" 2>/dev/null
do
    # Se o render server cair (ex.: falta de memória), sobe de novo
    # sem derrubar o site.
    if ! kill -0 "$RENDER_PID" 2>/dev/null; then
        echo "⚠️ Render server caiu, reiniciando..."
        start_render
    fi
    sleep 2
done

terminate
exit 1
