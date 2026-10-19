using Microsoft.AspNetCore.Mvc;
using Roblox.Libraries.DiscordApi;
using System.Text;

namespace Roblox.Website.Controllers
{
    [ApiController]
    public class DiscordOAuthController : Microsoft.AspNetCore.Mvc.Controller
    {
        [HttpGet("/api/applicationcallback")]
        public async Task<IActionResult> ApplicationCallback(
            [FromQuery] string? code)
        {
            if (string.IsNullOrWhiteSpace(code))
            {
                return BadRequest("O código do Discord não foi recebido.");
            }

            var discordApi = await DiscordApi.CreateFromOAuthCode(
                code,
                Roblox.Configuration.DiscordApplicationCallback
            );

            if (discordApi == null)
            {
                return BadRequest(
                    "Não foi possível autenticar com o Discord."
                );
            }

            var encodedToken = Convert.ToBase64String(
                Encoding.UTF8.GetBytes(discordApi.AccessToken)
            );

            Response.Cookies.Append(
                "MARINE-DISCORD",
                encodedToken,
                new CookieOptions
                {
                    HttpOnly = true,
                    Secure = true,
                    SameSite = SameSiteMode.Lax,
                    Path = "/",
                    IsEssential = true
                }
            );

            return Redirect("/auth/application");
        }
    }
}
