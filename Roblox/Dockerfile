FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

RUN echo "=== PASTAS NA RAIZ ===" && ls -la /src && \
    echo "=== PROCURANDO api/public ===" && \
    find /src -type d -path "*/api/public" 2>/dev/null | head -20

RUN dotnet restore Roblox/Roblox.sln

RUN dotnet publish Roblox/Roblox.Website/Roblox.Website.csproj \
    -c Release \
    -o /app/publish \
    --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

COPY --from=build /app/publish .
COPY --from=build /src/api/public /app/public

RUN if [ -d /app/public/css/Roblox ] && [ ! -d /app/public/css/roblox ]; then \
    ln -s Roblox /app/public/css/roblox; \
    fi

ENV ASPNETCORE_HTTP_PORTS=10000

EXPOSE 10000

ENTRYPOINT ["dotnet", "Roblox.Website.dll"]
