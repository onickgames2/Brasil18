using Roblox.Rendering;
using Roblox.Website.Middleware;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Net.Http.Headers;
using Roblox;
using Roblox.Services;
using Roblox.Services.App.FeatureFlags;
using Roblox.Website.Hubs;
using System.Reflection;
using Microsoft.OpenApi.Models;
using Microsoft.AspNetCore.Mvc.Formatters;
var domain = AppDomain.CurrentDomain;
// Set a timeout interval of 5 seconds.
domain.SetData("REGEX_DEFAULT_MATCH_TIMEOUT", TimeSpan.FromSeconds(5));

IConfiguration configuration = new ConfigurationBuilder()
    .AddJsonFile("appsettings.json", optional: true)
    .AddEnvironmentVariables()
    .Build();

Console.WriteLine(
    $"[DEBUG] Pants é URL: {configuration["PackagePantsAssetId"]?.StartsWith("rediss://") == true}"
);

Console.WriteLine(
    $"[DEBUG] Redis é URL: {configuration["Redis"]?.StartsWith("rediss://") == true}"
);

var builder = WebApplication.CreateBuilder(args);

// DB
Roblox.Services.Database.Configure(configuration.GetSection("Postgres").Value!);
var redisConfig = configuration.GetSection("Redis").Value;

Console.WriteLine(
    $"[REDIS DEBUG] Configuração encontrada: {!string.IsNullOrWhiteSpace(redisConfig)}"
);

Console.WriteLine(
    $"[REDIS DEBUG] Começa com rediss://: {redisConfig?.StartsWith("rediss://", StringComparison.OrdinalIgnoreCase)}"
);

Roblox.Services.Cache.Configure(
    redisConfig ?? throw new InvalidOperationException(
        "A configuração Redis não foi encontrada."
    )
);

// Config
Roblox.Configuration.CdnBaseUrl = configuration.GetSection("CdnBaseUrl").Value!;
Roblox.Configuration.AssetDirectory = configuration.GetSection("Directories:Asset").Value!;
Roblox.Configuration.StorageDirectory = configuration.GetSection("Directories:Storage").Value!;
Roblox.Configuration.ThumbnailsDirectory = configuration.GetSection("Directories:Thumbnails").Value!;
Roblox.Configuration.GroupIconsDirectory = configuration.GetSection("Directories:GroupIcons").Value!;
Roblox.Configuration.PublicDirectory = configuration.GetSection("Directories:Public").Value!;
Roblox.Configuration.XmlTemplatesDirectory = configuration.GetSection("Directories:XmlTemplates").Value!;
Roblox.Configuration.JsonDataDirectory = configuration.GetSection("Directories:JsonData").Value!;
Roblox.Configuration.ScriptDirectory = configuration.GetSection("Directories:ScriptsData").Value!;
Roblox.Configuration.AdminBundleDirectory = configuration.GetSection("Directories:AdminBundle").Value!;
Roblox.Configuration.EconomyChatBundleDirectory = configuration.GetSection("Directories:EconomyChatBundle").Value!;
Roblox.Configuration.BaseUrl = configuration.GetSection("BaseUrl").Value!;
Roblox.Configuration.ShortBaseUrl = Roblox.Configuration.BaseUrl!.Replace("https://www.", "");
Roblox.Configuration.HCaptchaPublicKey = configuration.GetSection("HCaptcha:Public").Value!;
Roblox.Configuration.HCaptchaPrivateKey = configuration.GetSection("HCaptcha:Private").Value!;
// Discord OAuth related Stuff
Roblox.Configuration.DiscordClientId = configuration.GetSection("Discord:ClientId").Value!;
Roblox.Configuration.DiscordClientSecret = configuration.GetSection("Discord:ClientSecret").Value!;
Roblox.Configuration.DiscordGuildId = configuration.GetSection("Discord:GuildId").Value!;
Roblox.Configuration.DiscordBotToken = configuration.GetSection("Discord:BotToken").Value!;
Roblox.Configuration.DiscordLogChannelId = configuration.GetSection("Discord:LogChannelId").Value!;
var appCallbackPath = configuration.GetSection("Discord:ApplicationCallback").Value;
string DiscordPath(string key, string fallback)
{
    var value = configuration.GetSection(key).Value;
    return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
}

Roblox.Configuration.DiscordApplicationCallback = Roblox.Configuration.BaseUrl + DiscordPath("Discord:ApplicationCallback", "/api/applicationcallback");
Roblox.Configuration.DiscordLoginCallback = Roblox.Configuration.BaseUrl + DiscordPath("Discord:LoginCallback", "/auth/discord-login");
Roblox.Configuration.DiscordLinkCallback = Roblox.Configuration.BaseUrl + DiscordPath("Discord:LinkCallback", "/bot/verify");
Console.WriteLine($"[DISCORD DEBUG] BaseUrl: {Roblox.Configuration.BaseUrl}");
Console.WriteLine($"[DISCORD DEBUG] ApplicationCallback: {Roblox.Configuration.DiscordApplicationCallback}");
Console.WriteLine($"[DISCORD DEBUG] LoginCallback: {Roblox.Configuration.DiscordLoginCallback}");
Console.WriteLine($"[DISCORD DEBUG] LinkCallback: {Roblox.Configuration.DiscordLinkCallback}");
Console.WriteLine($"[DISCORD DEBUG] ClientId definido: {!string.IsNullOrWhiteSpace(Roblox.Configuration.DiscordClientId)}");
Console.WriteLine($"[DISCORD DEBUG] ClientSecret definido: {!string.IsNullOrWhiteSpace(Roblox.Configuration.DiscordClientSecret)}");
Roblox.Configuration.GameServerAuthorization = configuration.GetSection("GameServerAuthorization").Value!;
Roblox.Configuration.BotAuthorization = configuration.GetSection("BotAuthorization").Value!;
Roblox.Configuration.RccAuthorization = configuration.GetSection("RccAuthorization").Value!;
Roblox.Configuration.ArbiterAuthorization = configuration.GetSection("ArbiterAuthorization").Value!;
Roblox.Configuration.GameServerIp = configuration.GetSection("GameServerIp").Value!;
Roblox.Configuration.UserAgentBypassSecret = configuration.GetSection("UserAgentBypassSecret").Value!;
Roblox.Configuration.VerificationSecret = configuration.GetSection("VerificationSecret").Value!;
Roblox.Configuration.LuaScriptsDirectory = configuration.GetSection("Directories:RCCLuaScripts").Value!;
Roblox.Configuration.GameServerIpAddresses = Array.Empty<Roblox.GameServerConfigEntry>();
Roblox.Configuration.AssetValidationServiceUrl =
    configuration.GetSection("AssetValidation:BaseUrl").Value!;
Roblox.Configuration.AssetValidationServiceAuthorization =
    configuration.GetSection("AssetValidation:Authorization").Value!;
GameServerService.Configure(string.Join(Guid.NewGuid().ToString(), new int [16].Select(_ => Guid.NewGuid().ToString()))); // More TODO: If we every load balance, this will break
Console.WriteLine($"[CONFIG DEBUG] Shirt ID válido: {long.TryParse(configuration["PackageShirtAssetId"], out _)}");
Console.WriteLine($"[CONFIG DEBUG] Pants ID válido: {long.TryParse(configuration["PackagePantsAssetId"], out _)}");

Console.WriteLine($"[CONFIG DEBUG] SignupAssetIds válidos: {configuration.GetSection("SignupAssetIds").GetChildren().All(x => long.TryParse(x.Value, out _))}");
Console.WriteLine($"[CONFIG DEBUG] SignupAvatarAssetIds válidos: {configuration.GetSection("SignupAvatarAssetIds").GetChildren().All(x => long.TryParse(x.Value, out _))}");
Roblox.Configuration.PackageShirtAssetId = long.Parse(configuration.GetSection("PackageShirtAssetId").Value!);
Roblox.Configuration.PackagePantsAssetId = long.Parse(configuration.GetSection("PackagePantsAssetId").Value!);
var twitterBearer = configuration.GetSection("Twitter:Bearer").Value;

if (!string.IsNullOrWhiteSpace(twitterBearer))
{
    Roblox.Libraries.TwitterApi.TwitterApi.Configure(twitterBearer);
}
// Sign up asset ids
var assetIdsStart = configuration.GetSection("SignupAssetIds").GetChildren().Select(assetIdStr => long.Parse(assetIdStr.Value!));
Roblox.Configuration.SignupAssetIds = assetIdsStart;
Roblox.Configuration.SignupAvatarAssetIds =
    configuration.GetSection("SignupAvatarAssetIds").GetChildren().Select(c => long.Parse(c.Value!));
#if DEBUG
Roblox.Configuration.RobloxAppPrefix = "rbxeconsimdev:";
#endif
FeatureFlags.StartUpdateFlagTask();
var ownerUserIdConfig = configuration.GetSection("OwnerUserId");
List<long> ownerUserIds = ownerUserIdConfig.Get<List<long>>()!;
Roblox.Website.Filters.StaffFilter.Configure(ownerUserIds!);
//Roblox.Website.Controllers.ThumbnailsControllerV1.StartThumbnailFixLoop();

builder.Services.AddRazorPages();
builder.Services.AddRequestDecompression();
builder.Services.AddControllers(options =>
{
    options.InputFormatters.Add(new XmlSerializerInputFormatter(options));
    options.RespectBrowserAcceptHeader = true;
})
.AddJsonOptions(o =>
{
    o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    o.JsonSerializerOptions.PropertyNamingPolicy = null;
});
builder.Services.AddSignalR();
// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.ResolveConflictingActions(apiDescriptions => apiDescriptions.First());
    c.IgnoreObsoleteActions();
    c.IgnoreObsoleteProperties();
    c.CustomSchemaIds(type => type.FullName);
    c.EnableAnnotations();
    c.SwaggerDoc("UserV1", new OpenApiInfo
    {
        Version = "v1",
        Title = "Users Api v1",
    });
    c.SchemaGeneratorOptions.SchemaIdSelector = type => type.ToString();
    c.OperationFilter<SwaggerFileOperationFilter>();
    var xmlFilename = $"{Assembly.GetExecutingAssembly().GetName().Name}.xml";
    c.IncludeXmlComments(Path.Combine(AppContext.BaseDirectory, xmlFilename));
});
builder.Services.AddMvc(c =>
    c.Conventions.Add(new ApiExplorerGetsOnlyConvention())
);

var app = builder.Build();
app.UseRouting();
app.UseSwaggerUI(c =>
{
    c.ShowCommonExtensions();

    c.SwaggerEndpoint("/swagger/UserV1/swagger.json", "UserV1");
});

var prepareResponseForCache = (StaticFileResponseContext ctx) =>
{
    const int durationInSeconds = 86400 * 365;
    ctx.Context.Response.Headers[HeaderNames.CacheControl] = "public,max-age=" + durationInSeconds;
    ctx.Context.Response.Headers.Remove(HeaderNames.LastModified);
};
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(
    Path.Combine(Roblox.Configuration.PublicDirectory, "css", "roblox")
),
    RequestPath = "/css",
    OnPrepareResponse = prepareResponseForCache,
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(Path.Combine(Roblox.Configuration.PublicDirectory, "js")),
    RequestPath = "/js",
    OnPrepareResponse = prepareResponseForCache,
});
// Should be public
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(Path.Combine(Roblox.Configuration.PublicDirectory, "UnsecuredContent")),
    RequestPath = "/UnsecuredContent",
    OnPrepareResponse = prepareResponseForCache,
});

// Ensure thumbnail directories exist and use absolute paths.
Roblox.Configuration.ThumbnailsDirectory = "/app/public/images/thumbnails";
Roblox.Configuration.GroupIconsDirectory = "/app/public/images/groups";

Directory.CreateDirectory(Roblox.Configuration.ThumbnailsDirectory);
Directory.CreateDirectory(Roblox.Configuration.GroupIconsDirectory);

if (string.IsNullOrWhiteSpace(Roblox.Configuration.CdnBaseUrl))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(
            Roblox.Configuration.ThumbnailsDirectory
        ),
        RequestPath = "/images/thumbnails",
        OnPrepareResponse = prepareResponseForCache,
    });

    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(
            Roblox.Configuration.GroupIconsDirectory
        ),
        RequestPath = "/images/groups",
        OnPrepareResponse = prepareResponseForCache,
    });
}

#if FALSE
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(Roblox.Configuration.EconomyChatBundleDirectory),
    RequestPath = "/chat",
    ServeUnknownFileTypes = false,
    OnPrepareResponse = prepareResponseForCache,
});
#endif

app.UseRobloxSessionMiddleware();
app.UseMiddleware<ThumbnailMiddleware>(Roblox.Configuration.ThumbnailsDirectory);
app.UseMiddleware<RobloxLoggingMiddleware>();
app.UseRobloxPlayerCorsMiddleware(); // cors varies depending on authentication status, so it must be after session middleware

app.UseRobloxCsrfMiddleware();
app.UseApplicationGuardMiddleware();
Roblox.Website.Middleware.ApplicationGuardMiddleware.Configure(configuration.GetSection("Authorization").Value!);
Roblox.Website.Middleware.CsrfMiddleware.Configure(Guid.NewGuid().ToString() + Guid.NewGuid().ToString() + Guid.NewGuid().ToString()); // TODO: This would break if we ever load balance

app.UseSwagger();
app.UseSwaggerUI();

app.UseMiddleware<FrontendProxyMiddleware>();
//app.UseMiddleware<RobloxLoggingMiddleware>();
//app.UseRobloxLoggingMiddleware();

app.UseExceptionHandler("/error");
//await CommandHandler.Configure("ws://localhost:3189", "hello world of deving 1234");
//CommandHandler.Configure(configuration.GetSection("Render:BaseUrl").Value, configuration.GetSection("Render:Authorization").Value); // will be removed soon

RenderingHandler.Configure();
SessionMiddleware.Configure(configuration.GetSection("Jwt:Sessions").Value!);
app.UseTimerMiddleware(); // Must always be last
Roblox.Services.Signer.SignService.Setup();
_ = Task.Run(async () =>
{
    using var assets = Roblox.Services.ServiceProvider.GetOrCreate<AssetsService>();
    await assets.FixAssetImagesWithoutMetadata();
});
_ = Task.Run(AvatarService.StartTimerClear3D);
app.MapControllers();
app.MapRazorPages();
app.UseWebSockets();
app.UseRequestDecompression();
app.MapHub<MessageRouterHub>("/v1/router/signalr");
app.Run();
