using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging;
using WdsWeb.Api.Wds.Demo;

namespace WdsWeb.Api.Tests;

/// <summary>Demo mode answers every page from sample data, with no WDS server, and changes nothing.</summary>
public sealed class DemoModeTests(DemoModeTests.DemoApp app) : IClassFixture<DemoModeTests.DemoApp>
{
    public sealed class DemoApp : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Production");
            builder.UseSetting("Wds:Mode", "Demo");
            builder.UseSetting("Auth:Enabled", "false");
            builder.ConfigureLogging(logging => logging.ClearProviders());
        }
    }

    private readonly HttpClient _client = app.CreateClient();

    [Theory]
    [InlineData("/api/connection")]
    [InlineData("/api/target")]
    [InlineData("/api/server/config")]
    [InlineData("/api/boot-images")]
    [InlineData("/api/install-images")]
    [InlineData("/api/devices")]
    [InlineData("/api/drivers")]
    [InlineData("/api/events?hours=168")]
    [InlineData("/api/activity?hours=168")]
    [InlineData("/api/images/files")]
    [InlineData("/api/drivers/files")]
    [InlineData("/api/console")]
    [InlineData("/api/install-images/unattend?name=Windows%2011%20Pro&imageGroup=Windows%2011")]
    public async Task Answers_every_page(string path)
    {
        var response = await _client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Shows_boots_at_every_stage_including_an_install_under_way()
    {
        var activity = await _client.GetFromJsonAsync<JsonElement>("/api/activity?hours=168");
        var sessions = activity.GetProperty("sessions").EnumerateArray().ToList();

        Assert.True(sessions.Count >= 6);
        Assert.Contains(sessions, s => s.GetProperty("deployment") is { ValueKind: JsonValueKind.Object } d && d.GetProperty("stage").GetString() == "applying");
        Assert.Contains(sessions, s => s.GetProperty("deployment") is { ValueKind: JsonValueKind.Object } d && d.GetProperty("stage").GetString() == "failed");
        Assert.Contains(sessions, s => s.GetProperty("status").GetString() == "downloading");
    }

    [Fact]
    public async Task Parses_its_sample_driver_store()
    {
        var drivers = await _client.GetFromJsonAsync<JsonElement>("/api/drivers");

        Assert.True(drivers.GetProperty("packages").GetArrayLength() > 10);
        Assert.True(drivers.GetProperty("groups").GetArrayLength() > 3);
        // Its model groups have filters, written as WDSUTIL writes them and read back as it takes them.
        Assert.Contains(drivers.GetProperty("groups").EnumerateArray(), g =>
            g.GetProperty("filters").EnumerateArray().Any(f => f.GetProperty("type").GetString() == "ChassisType" &&
                f.GetProperty("values").EnumerateArray().Any(v => v.GetString() == "MiniTower")));
    }

    [Theory]
    [InlineData("POST", "/api/devices", """{"name":"PC-01","deviceId":"00-00-5E-00-53-01"}""")]
    [InlineData("POST", "/api/boot-images/disable", """{"name":"WinPE Tools (x64)","architecture":"X64"}""")]
    [InlineData("PUT", "/api/server/hands-free", """{"allow":true}""")]
    [InlineData("POST", "/api/uploads", """{"fileName":"boot.wim","size":1024}""")]
    [InlineData("POST", "/api/drivers/import", """{"serverPath":"C:\\Drivers\\Dell.zip","createGroup":false,"deleteUploadAfter":false}""")]
    [InlineData("POST", "/api/drivers/groups", """{"name":"Dell laptops"}""")]
    [InlineData("POST", "/api/boot-images/drivers", """{"imageName":"WinPE","architecture":"x64","packageIds":["{08611570-9951-4B50-A49A-F4EFAEBE3A0D}"]}""")]
    [InlineData("PUT", "/api/drivers/groups/Network%20adapters", """{"enabled":false}""")]
    [InlineData("DELETE", "/api/drivers/groups/Network%20adapters", "{}")]
    [InlineData("POST", "/api/drivers/packages/batch", """{"ids":["{08611570-9951-4B50-A49A-F4EFAEBE3A0D}"],"action":"remove"}""")]
    public async Task Changes_nothing(string method, string path, string body)
    {
        var response = await _client.SendAsync(new HttpRequestMessage(new HttpMethod(method), path)
        {
            Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(DemoWds.NothingChanges, (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString());
    }
}
