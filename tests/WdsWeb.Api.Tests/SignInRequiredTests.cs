using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging;

namespace WdsWeb.Api.Tests;

/// <summary>
/// With sign-in on (the production default), nothing that touches WDS answers an anonymous request.
/// These never reach a WDS server: the requests stop at authorization.
/// </summary>
public sealed class SignInRequiredTests(SignInRequiredTests.ProductionApp app) : IClassFixture<SignInRequiredTests.ProductionApp>
{
    public sealed class ProductionApp : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Production");
            // Keep test runs out of the machine's event log.
            builder.ConfigureLogging(logging => logging.ClearProviders());
        }
    }

    private readonly HttpClient _client = app.CreateClient();

    [Theory]
    [InlineData("GET", "/api/connection")]
    [InlineData("GET", "/api/boot-images")]
    [InlineData("GET", "/api/server/config")]
    [InlineData("GET", "/api/uploads")]
    [InlineData("POST", "/api/boot-images/remove")]
    [InlineData("PUT", "/api/server/settings/pxe")]
    [InlineData("POST", "/api/server/restart")]
    [InlineData("POST", "/api/images/import")]
    [InlineData("GET", "/api/devices")]
    [InlineData("POST", "/api/devices")]
    [InlineData("PUT", "/api/devices/PC-01")]
    [InlineData("DELETE", "/api/devices/PC-01")]
    [InlineData("POST", "/api/devices/requests/7/approve")]
    [InlineData("POST", "/api/devices/requests/7/reject")]
    [InlineData("POST", "/api/devices/requests/clear")]
    [InlineData("POST", "/api/drivers/import")]
    [InlineData("GET", "/api/drivers/files")]
    [InlineData("POST", "/api/drivers/groups")]
    [InlineData("PUT", "/api/drivers/groups/Dell")]
    [InlineData("DELETE", "/api/drivers/groups/Dell")]
    [InlineData("PUT", "/api/drivers/packages/{08611570-9951-4B50-A49A-F4EFAEBE3A0D}")]
    [InlineData("DELETE", "/api/drivers/packages/{08611570-9951-4B50-A49A-F4EFAEBE3A0D}")]
    [InlineData("POST", "/api/drivers/packages/batch")]
    [InlineData("PUT", "/api/boot-images/properties")]
    [InlineData("PUT", "/api/install-images/properties")]
    [InlineData("GET", "/api/install-images/unattend?name=Windows")]
    [InlineData("PUT", "/api/server/hands-free")]
    [InlineData("GET", "/api/console")]
    public async Task Refuses_anonymous_requests(string method, string path)
    {
        var response = await _client.SendAsync(new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(new { }) });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Answers_the_health_check_without_sign_in()
    {
        var response = await _client.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Keeps_the_deep_health_check_to_the_server_itself()
    {
        // The test server's requests carry no client address, so they don't count as this machine.
        var response = await _client.GetAsync("/api/health?deep=true");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Says_nobody_is_signed_in()
    {
        var session = await _client.GetFromJsonAsync<JsonElement>("/api/auth/me");

        Assert.True(session.GetProperty("authEnabled").GetBoolean());
        Assert.False(session.GetProperty("authenticated").GetBoolean());
    }

    [Fact]
    public async Task Rejects_an_empty_sign_in_without_trying_windows()
    {
        var response = await _client.PostAsJsonAsync("/api/auth/login", new { userName = "", password = "" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
