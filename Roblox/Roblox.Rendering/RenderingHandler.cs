using System.Diagnostics;
using System.Text;
using Roblox;
using System.Text.Json;
using System.Net.Http.Json;
using System.Dynamic;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Processing;
using SixLabors.ImageSharp.Formats.Png;

namespace Roblox.Rendering
{
    public class RenderingHandler
    {
        private static Random RandomComponent = new Random();
        private static HttpClient client = new HttpClient();

        // Se true, Avatar e Headshot vêm da API oficial da Roblox.
        // Para desligar, defina a variável de ambiente USE_ROBLOX_API=false
        private static bool UseRobloxApi =>
            (Environment.GetEnvironmentVariable("USE_ROBLOX_API") ?? "true").ToLower() != "false";

        // Opcional: defina isso para mapear o ID do usuário do seu site para um ID real do Roblox.
        // Exemplo: RenderingHandler.RobloxIdResolver = async siteId => await MinhaConsultaNoBanco(siteId);
        public static Func<long, Task<long?>>? RobloxIdResolver { get; set; }

        private enum RenderType
        {
            Avatar = 0,
            Headshot,
            Head,
            Package,
            BodyPart,
            Image,
            Clothing,
            TeeShirt,
            Face,
            Mesh,
            MeshPart,
            Hat,
            Place,
            Model,
            Emote,
            Animation,
            Avatar3D
        }

        private class RenderResponse
        {
            public bool success { get; set; }
            public string? message { get; set; }
            public string? data { get; set; }
        }

        public static void Configure()
        {
        }

        public static Dictionary<long, string> allowedPlaceForRender = new Dictionary<long, string>();

        // ---------------------------------------------------------------
        // API DA ROBLOX (avatar e headshot)
        // ---------------------------------------------------------------

        private static async Task<long> ResolveRobloxUserId(long siteUserId)
        {
            if (RobloxIdResolver != null)
            {
                try
                {
                    var mapped = await RobloxIdResolver(siteUserId);
                    if (mapped.HasValue && mapped.Value > 0)
                        return mapped.Value;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[RenderingHandler] Erro no RobloxIdResolver: {ex.Message}");
                }
            }

            // Fallback: ID padrão (variável ROBLOX_DEFAULT_USER_ID) ou 1
            var envId = Environment.GetEnvironmentVariable("ROBLOX_DEFAULT_USER_ID");
            if (long.TryParse(envId, out var parsed) && parsed > 0)
                return parsed;

            return 1;
        }

        // Retorna a imagem PNG em base64, ou "FAILURE"
        private static async Task<string> GetRobloxApiThumbnail(long siteUserId, bool headshot)
        {
            var sw = Stopwatch.StartNew();
            long robloxId = await ResolveRobloxUserId(siteUserId);
            string tipo = headshot ? "avatar-headshot" : "avatar";
            string apiUrl = $"https://thumbnails.roblox.com/v1/users/{tipo}?userIds={robloxId}&size=420x420&format=Png&isCircular=false";

            for (int tentativa = 0; tentativa < 5; tentativa++)
            {
                try
                {
                    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                    string json = await client.GetStringAsync(apiUrl, cts.Token);
                    using var doc = JsonDocument.Parse(json);
                    var item = doc.RootElement.GetProperty("data")[0];
                    string? state = item.GetProperty("state").GetString();

                    if (state == "Completed")
                    {
                        string? imageUrl = item.GetProperty("imageUrl").GetString();
                        if (!string.IsNullOrEmpty(imageUrl))
                        {
                            byte[] bytes = await client.GetByteArrayAsync(imageUrl, cts.Token);
                            sw.Stop();
                            Console.WriteLine($"[RenderingHandler] Roblox API ({tipo}) user {siteUserId} -> robloxId {robloxId} OK em {sw.ElapsedMilliseconds}ms");
                            return Convert.ToBase64String(bytes);
                        }
                    }
                    else if (state == "Blocked" || state == "Error")
                    {
                        Console.WriteLine($"[RenderingHandler] Roblox API retornou estado {state} para robloxId {robloxId}");
                        return "FAILURE";
                    }
                    // "Pending" ou "InReview": espera e tenta de novo
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[RenderingHandler] Falha na Roblox API (tentativa {tentativa + 1}): {ex.Message}");
                }

                await Task.Delay(1000);
            }

            Console.WriteLine($"[RenderingHandler] Roblox API não retornou imagem para robloxId {robloxId}");
            return "FAILURE";
        }

        // ---------------------------------------------------------------
        // RENDER SERVER (todo o resto)
        // ---------------------------------------------------------------

        private static async Task<dynamic> SendRenderRequest(long id, RenderType type, int? x = 0, int? y = 0, bool? isFace = false, string? assetUrl = null, string? characterAppearanceUrl = null, string? animationUrl = null)
        {
            // Avatar e headshot usam a API da Roblox
            if (UseRobloxApi && (type == RenderType.Avatar || type == RenderType.Headshot))
            {
                return await GetRobloxApiThumbnail(id, type == RenderType.Headshot);
            }

            // Avatar 3D não é suportado pela API simples da Roblox
            if (UseRobloxApi && type == RenderType.Avatar3D)
            {
                Console.WriteLine("[RenderingHandler] Avatar3D não é suportado via Roblox API");
                return "FAILURE";
            }

            Stopwatch sw = new Stopwatch();
            sw.Start();
            string url = "";
            dynamic renderRequest = new ExpandoObject();

            switch (type)
            {
                case RenderType.Avatar:
                    renderRequest.userId = id;
                    url = "player/thumbnail";
                    break;
                case RenderType.Avatar3D:
                    renderRequest.userId = id;
                    url = "player/thumbnail-3d";
                    break;
                case RenderType.Headshot:
                    renderRequest.userId = id;
                    url = "player/headshot";
                    break;
                case RenderType.Package:
                    Console.WriteLine("[RenderingHandler] Requesting package render for " + assetUrl);
                    renderRequest.assetUrls = assetUrl;
                    url = "catalog/package";
                    break;
                case RenderType.BodyPart:
                    renderRequest.assetUrl = assetUrl;
                    url = "catalog/bodypart";
                    break;
                case RenderType.Head:
                    renderRequest.assetId = id;
                    url = "catalog/head";
                    break;
                case RenderType.Image:
                    renderRequest.assetId = id;
                    renderRequest.isFace = isFace;
                    url = "image/image";
                    break;
                case RenderType.Clothing:
                    renderRequest.assetId = id;
                    url = "image/clothing";
                    break;
                case RenderType.TeeShirt:
                    renderRequest.assetId = id;
                    url = "image/teeshirt";
                    break;
                case RenderType.Mesh:
                    renderRequest.assetId = id;
                    url = "catalog/mesh";
                    break;
                case RenderType.Hat:
                    renderRequest.assetId = id;
                    url = "catalog/hat";
                    break;
                case RenderType.Place:
                    renderRequest.placeId = id;
                    renderRequest.x = x;
                    renderRequest.y = y;
                    url = "game/thumbnail";
                    allowedPlaceForRender.TryAdd(id, "");
                    break;
                case RenderType.Model:
                    renderRequest.assetId = id;
                    url = "catalog/model";
                    break;
                case RenderType.Emote:
                    renderRequest.assetId = id;
                    url = "catalog/animationsilhouette";
                    break;
                case RenderType.Animation:
                    renderRequest.characterAppearanceUrl = characterAppearanceUrl;
                    renderRequest.animationUrl = animationUrl;
                    url = "catalog/animation";
                    break;
                default:
                    Console.WriteLine($"[RenderingHandler] Tipo de render não suportado: {type}");
                    return "FAILURE";
            }

            string baseUrl = Environment.GetEnvironmentVariable("RENDER_BASE_URL") ?? "http://localhost:7832/";
            if (!baseUrl.EndsWith("/")) baseUrl += "/";
            string fullUrl = baseUrl + url;

            try
            {
                var content = new StringContent(JsonSerializer.Serialize(renderRequest), Encoding.UTF8, "application/json");
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
                HttpResponseMessage response = await client.PostAsync(fullUrl, content, cts.Token);
                string body = await response.Content.ReadAsStringAsync();
                sw.Stop();

                Console.WriteLine($"[RenderingHandler] POST {fullUrl} -> {(int)response.StatusCode} em {sw.ElapsedMilliseconds}ms");

                if (!response.IsSuccessStatusCode)
                {
                    Console.WriteLine($"[RenderingHandler] Erro do servidor de render: {body}");
                    return "FAILURE";
                }

                var result = JsonSerializer.Deserialize<RenderResponse>(body);
                if (result == null || !result.success || string.IsNullOrEmpty(result.data))
                {
                    Console.WriteLine($"[RenderingHandler] Render falhou: {result?.message ?? body}");
                    return "FAILURE";
                }
                return result.data;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[RenderingHandler] Exceção ao chamar {fullUrl}: {ex.Message}");
                return "FAILURE";
            }
        }

        public static async Task<string> RequestHatThumbnail(long assetId)
        {
            return await SendRenderRequest(assetId, RenderType.Hat);
        }

        public static async Task<string> RequestMeshThumbnail(long assetId)
        {
            return await SendRenderRequest(assetId, RenderType.Mesh);
        }

        public static async Task<string> RequestMeshPartThumbnail(long assetId)
        {
            return await SendRenderRequest(assetId, RenderType.MeshPart);
        }

        public static async Task<string> RequestModelThumbnail(long assetId)
        {
            return await SendRenderRequest(assetId, RenderType.Model);
        }

        public static async Task<string> RequestImageThumbnail(long assetId, bool isFace = false)
        {
            return await SendRenderRequest(assetId, RenderType.Image, isFace: isFace);
        }

        public static async Task<string> RequestPlaceRender(long assetId, int x, int y)
        {
            return await SendRenderRequest(assetId, RenderType.Place, x, y);
        }

        public static async Task<string> RequestClothingRender(long assetId)
        {
            return await SendRenderRequest(assetId, RenderType.Clothing);
        }

        public static async Task<string> RequestTeeShirtRender(long assetId)
        {
            return await SendRenderRequest(assetId, RenderType.TeeShirt);
        }

        public static async Task<string> RequestHeadRender(long assetId)
        {
            return await SendRenderRequest(assetId, RenderType.Head);
        }

        public static async Task<string> RequestAnimationSilhouetteRender(long assetId)
        {
            return await SendRenderRequest(assetId, RenderType.Emote);
        }

        public static async Task<string> RequestAnimationRender(string characterAppearanceUrl, string animationUrl)
        {
            return await SendRenderRequest(0, RenderType.Animation, characterAppearanceUrl: characterAppearanceUrl, animationUrl: animationUrl);
        }

        public static async Task<string> RequestPackageRender(string assetUrls)
        {
            return await SendRenderRequest(0, RenderType.Package, assetUrl: assetUrls);
        }

        public static async Task<string> RequestBodyPartRender(string assetUrl)
        {
            return await SendRenderRequest(0, RenderType.BodyPart, assetUrl: assetUrl);
        }

        public static async Task<string> RequestPlayerThumbnail(long userId)
        {
            return await SendRenderRequest(userId, RenderType.Avatar);
        }

        public static async Task<string> RequestPlayerThumbnail3D(long userId)
        {
            return await SendRenderRequest(userId, RenderType.Avatar3D);
        }

        public static async Task<string> RequestHeadshotThumbnail(long userId)
        {
            return await SendRenderRequest(userId, RenderType.Headshot);
        }

        /// <summary>
        /// Redimensiona uma imagem para a largura e altura informadas.
        /// TImageType pode ser string base64, byte[] ou Stream (com Seek).
        /// TReturn pode ser MemoryStream, byte[] ou string base64 (PNG).
        /// </summary>
        public static async Task<TReturn> ResizeImage<TReturn, TImageType>(TImageType inputImage, int width, int height)
        {
            MemoryStream imageStream;

            if (typeof(TImageType) == typeof(string))
            {
                string base64 = (string)(object)inputImage!;
                byte[] imageBytes = Convert.FromBase64String(base64);
                imageStream = new MemoryStream(imageBytes);
            }
            else if (typeof(TImageType) == typeof(byte[]))
            {
                byte[] bytes = (byte[])(object)inputImage!;
                imageStream = new MemoryStream(bytes);
            }
            else if (typeof(Stream).IsAssignableFrom(typeof(TImageType)))
            {
                var inputStream = (Stream)(object)inputImage!;
                if (!inputStream.CanSeek)
                    throw new ArgumentException("Input stream must be seekable.");

                inputStream.Position = 0;

                imageStream = new MemoryStream();
                await inputStream.CopyToAsync(imageStream);
                imageStream.Position = 0;
            }
            else
            {
                throw new ArgumentException("Unsupported image type for resizing.");
            }

            using (imageStream)
            {
                using var image = await Image.LoadAsync(imageStream);
                image.Mutate(x => x.Resize(width, height));

                if (typeof(TReturn) == typeof(MemoryStream))
                {
                    var outStream = new MemoryStream();
                    await image.SaveAsync(outStream, new PngEncoder());
                    outStream.Position = 0;
                    return (TReturn)(object)outStream;
                }

                if (typeof(TReturn) == typeof(byte[]))
                {
                    var outStream = new MemoryStream();
                    await image.SaveAsync(outStream, new PngEncoder());
                    outStream.Position = 0;
                    return (TReturn)(object)outStream.ToArray();
                }

                if (typeof(TReturn) == typeof(string))
                {
                    var outStream = new MemoryStream();
                    await image.SaveAsync(outStream, new PngEncoder());
                    outStream.Position = 0;
                    byte[] bytesResult = outStream.ToArray();
                    string base64Result = Convert.ToBase64String(bytesResult);
                    return (TReturn)(object)base64Result;
                }

                throw new ArgumentException("Unsupported return type requested.");
            }
        }
    }
}
