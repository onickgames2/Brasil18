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
# 2. Compilar o backend
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

# 3. Container final: frontend + backend

# ==========================================

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime

# Instalar Node.js e npm

RUN apt-get update \
&& apt-get install -y curl ca-certificates gnupg \
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

RUN echo "=== VERIFICANDO CSS ROBLOX ===" && \
    ls -la /app/public/css/ && \
    ls -la /app/public/css/roblox/

RUN ls -la /app/public/css/roblox/ || true

# Frontend compilado

WORKDIR /app/Frontend

COPY --from=frontend-build /src/frontend/package*.json ./
COPY --from=frontend-build /src/frontend/ ./

RUN npm install --omit=dev

# Inicializador

WORKDIR /app

COPY start.sh /app/start.sh

RUN chmod +x /app/start.sh

ENV ASPNETCORE_HTTP_PORTS=10000

EXPOSE 10000

ENTRYPOINT ["/app/start.sh"]
