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
CMD ["sh", "-c", "ASPNETCORE_URLS=http://0.0.0.0:${PORT:-10000} dotnet Roblox.Website.dll"]
