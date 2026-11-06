# ==========================================
# 1. Compilar o frontend
# ==========================================
FROM node:20-bookworm-slim AS frontend-build

WORKDIR /src/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# ==========================================
# 2. Compilar o painel admin (Svelte)
# ==========================================
FROM node:18 AS admin-build

WORKDIR /admin

COPY admin/package*.json ./
RUN npm install

COPY admin/ .
RUN npm run build

# ==========================================
# 3. Compilar o backend
# ==========================================
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS backend-build

WORKDIR /src

COPY . .

RUN dotnet restore Roblox/Roblox.sln

RUN dotnet publish Roblox/Roblox.Website/Roblox.Website.csproj \
    -c Release \
    -o /app/publish \
    --no-restore

# ==========================================
# 4. Compilar o serviço de validação de assets (Go)
# ==========================================
FROM golang:1.22 AS validator-build

WORKDIR /validator

COPY AssetValidationServiceV2/ .
RUN CGO_ENABLED=0 go build -o /validator-bin .

# ==========================================
# 5. Container final: frontend + backend + render + validação + admin
# ==========================================
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime

# Node.js + libsodium + Chromium (render do avatar)
RUN apt-get update \
 && apt-get install -y curl ca-certificates gnupg libsodium23 \
    chromium fonts-liberation libgl1-mesa-dri libgles2 \
 && install -d /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend
COPY --from=backend-build /app/publish .
COPY --from=backend-build /src/Roblox/Roblox.Website/Keys /app/Keys

# Arquivos públicos
COPY --from=backend-build /src/api/public/ /app/public/

RUN if [ -d /app/public/css/Roblox ]; then \
      mv /app/public/css/Roblox /app/public/css/roblox; \
    fi

RUN test -d /app/public/css/roblox
RUN ls -la /app/public/css/roblox/

# Dados JSON
COPY --from=backend-build /src/JsonData/ /app/JsonData/
RUN test -f /app/JsonData/avatar-colors.json

# Painel admin: com AdminBundleDirectory vazio o backend lê /index.html e /build/bundle.(js|css)
COPY --from=admin-build /admin/public/index.html /index.html
COPY --from=admin-build /admin/public/build /build

# Frontend compilado
WORKDIR /app/Frontend

COPY --from=frontend-build /src/frontend/package*.json ./
COPY --from=frontend-build /src/frontend/ ./

RUN npm install --omit=dev

# Render server (three.js + Chromium)
WORKDIR /app/render-server

COPY render-server/package.json ./
RUN npm install --omit=dev
COPY render-server/ ./

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV RENDER_PORT=7832
ENV MAX_CONCURRENT=1

# Serviço de validação de assets (Go): o start.sh sobe na porta 4300
WORKDIR /app/asset-validation
COPY --from=validator-build /validator-bin ./asset-validation

# Inicializador
WORKDIR /app

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# O Render define PORT (10000): quem usa é o BACKEND (ele faz proxy pro Next).
# O Next.js usa FRONTEND_PORT e o backend responde na porta pública.
ENV BACKEND_PORT=5000
EXPOSE 10000

ENTRYPOINT ["/app/start.sh"]
