FROM node:18 AS admin-build
WORKDIR /admin
COPY admin/package*.json ./
RUN npm install
COPY admin/ .
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY . .
RUN dotnet restore Roblox.Website.csproj
RUN dotnet publish Roblox.Website.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
# o libsodium.dll do repo é de Windows; no Linux precisa da lib instalada
RUN apt-get update && apt-get install -y libsodium23 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish .
# Painel admin: com AdminBundleDirectory vazio o backend lê /index.html e /build/bundle.(js|css)
COPY --from=admin-build /admin/public/index.html /index.html
COPY --from=admin-build /admin/public/build /build
CMD ["sh", "-c", "ASPNETCORE_URLS=http://0.0.0.0:${PORT:-10000} dotnet Roblox.Website.dll"]
