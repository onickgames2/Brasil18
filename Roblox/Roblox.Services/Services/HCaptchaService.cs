using System.Net.Http.Json;
using System.Text.Json.Serialization;

public class HCaptchaService
{
    private readonly HttpClient _http;
    private readonly string _secret;

    public HCaptchaService(HttpClient http, IConfiguration config)
    {
        _http = http;
        _secret = config["HCaptcha:Private"] ?? "";
    }

    public async Task<bool> VerifyAsync(string? token)
    {
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrEmpty(_secret))
            return false;

        var form = new Dictionary<string, string>
        {
            ["secret"] = _secret,
            ["response"] = token
        };

        using var res = await _http.PostAsync(
            "https://api.hcaptcha.com/siteverify",
            new FormUrlEncodedContent(form));

        if (!res.IsSuccessStatusCode) return false;

        var result = await res.Content.ReadFromJsonAsync<HCaptchaResult>();
        return result?.Success == true;
    }

    private class HCaptchaResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }
    }
}
