#!/bin/sh

echo "🇧🇷 Iniciando BRASIL17..."

# Porta pública do Render: quem usa é o BACKEND (ele faz proxy pro Next)
PUBLIC_PORT="${PORT:-10000}"
# Porta interna do Next.js (precisa ser a mesma do FrontendProxyMiddleware)
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
# Porta interna do render server (o RenderingHandler usa localhost:7832 por padrão)
RENDER_PORT="${RENDER_PORT:-7832}"
# Porta interna do serviço de validação (AssetValidation__BaseUrl = http://localhost:4300)
VALIDATION_PORT="${VALIDATION_PORT:-4300}"
VALIDATION_BIN="/app/asset-validation/asset-validation"
# Backup dos uploads no banco (imagens, assets): restaura ao subir e copia a cada ciclo
SYNC_SCRIPT="/app/render-server/storage-sync.mjs"

FRONTEND_PID=""
RENDER_PID=""
VALIDATION_PID=""
SYNC_PID=""

# Serviço de validação de assets (Go), só se o programa existir
start_validation() {
    if [ ! -x "$VALIDATION_BIN" ]; then
        return 1
    fi
    cd /app/asset-validation || return 1
    PORT="$VALIDATION_PORT" "$VALIDATION_BIN" &
    VALIDATION_PID=$!
    cd /app || return 1
}
if start_validation; then
    echo "✅ Serviço de validação iniciado na porta $VALIDATION_PORT."
else
    echo "⚠️ Serviço de validação não encontrado em $VALIDATION_BIN, seguindo sem ele."
fi

# Restaura do banco os arquivos enviados antes (o disco é apagado a cada deploy).
# Roda ANTES do backend para os arquivos já estarem no lugar quando o site abrir.
if [ -f "$SYNC_SCRIPT" ]; then
    echo "📦 Restaurando uploads salvos no banco..."
    (cd /app/render-server && timeout 180 node storage-sync.mjs restore) \
        || echo "⚠️ Restauração não concluída, seguindo sem ela."
fi

# Backend (ASP.NET) na porta pública
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

# Cópia contínua dos uploads para o banco, só se o script existir
start_sync() {
    if [ ! -f "$SYNC_SCRIPT" ]; then
        return 1
    fi
    cd /app/render-server || return 1
    node storage-sync.mjs watch &
    SYNC_PID=$!
    cd /app || return 1
}
if start_sync; then
    echo "✅ Backup dos uploads no banco ativo."
fi

terminate() {
    kill "$FRONTEND_PID" "$BACKEND_PID" "$RENDER_PID" $VALIDATION_PID $SYNC_PID 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
    wait "$RENDER_PID" 2>/dev/null || true
    [ -n "$VALIDATION_PID" ] && wait "$VALIDATION_PID" 2>/dev/null || true
    # espera a cópia final dos uploads terminar
    [ -n "$SYNC_PID" ] && wait "$SYNC_PID" 2>/dev/null || true
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
    # Mesma coisa para o serviço de validação, se ele existir
    if [ -n "$VALIDATION_PID" ] && ! kill -0 "$VALIDATION_PID" 2>/dev/null; then
        echo "⚠️ Serviço de validação caiu, reiniciando..."
        start_validation
    fi
    # E para o backup dos uploads
    if [ -n "$SYNC_PID" ] && ! kill -0 "$SYNC_PID" 2>/dev/null; then
        echo "⚠️ Backup dos uploads caiu, reiniciando..."
        start_sync
    fi
    sleep 2
done

terminate
exit 1
