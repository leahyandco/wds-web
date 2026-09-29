using System.Text.Json;
using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Endpoints;

public static class WdsEndpoints
{
    private const int MaxHours = 24 * 31;

    public static void MapWdsEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        // Answers without touching the server, so the UI can say what it's connecting to.
        api.MapGet("/connection", (WdsSessionPool pool) =>
            new ConnectionResponse(pool.Mode.ToString(), pool.TargetName));

        api.MapGet("/target", (WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunAsync("Get-TargetInfo", ct: ct));

        api.MapGet("/server/config", async (WdsScriptRunner wds, CancellationToken ct) =>
        {
            var result = await wds.RunAsync("Get-ServerConfig", ct: ct);
            var output = result.GetProperty("wdsUtilOutput").GetString() ?? "";
            return new ServerConfigResponse(
                result.GetProperty("wdsUtilExitCode").GetInt32(),
                WdsUtilOutputParser.Parse(output),
                output,
                result.GetProperty("remoteInstall"),
                result.GetProperty("allowHandsFreeFunctionality"));
        });

        api.MapGet("/boot-images", (WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunAsync("Get-BootImages", ct: ct));

        api.MapGet("/install-images", (WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunAsync("Get-InstallImages", ct: ct));

        api.MapGet("/devices", (WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunAsync("Get-Devices", ct: ct));

        api.MapGet("/drivers", async (WdsScriptRunner wds, CancellationToken ct) =>
        {
            var reports = await wds.RunAsync("Get-DriverPackages", ct: ct);
            return WdsUtilDriverParser.Parse(reports.GetProperty("packages").GetString() ?? "", reports.GetProperty("groups").GetString() ?? "");
        });

        api.MapGet("/events", (int? hours, int? max, bool? routine, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunAsync("Get-Events", new Dictionary<string, object?>
            {
                ["Hours"] = Math.Clamp(hours ?? 72, 1, MaxHours),
                ["MaxEvents"] = Math.Clamp(max ?? 300, 1, 5000),
                ["IncludeRoutine"] = routine ?? false,
            }, ct: ct));

        api.MapGet("/activity", async (int? hours, WdsScriptRunner wds, CancellationToken ct) =>
        {
            var result = await wds.RunAsync("Get-BootActivity", new Dictionary<string, object?>
            {
                ["Hours"] = Math.Clamp(hours ?? 72, 1, MaxHours),
            }, ct: ct);

            var events = result.GetProperty("events").EnumerateArray().Select(e => new WdsEventRecord(
                e.GetProperty("time").GetDateTimeOffset(),
                e.GetProperty("id").GetInt32(),
                e.GetProperty("data").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString() ?? "")));

            return new ActivityResponse(
                BootActivity.Build(events, DateTimeOffset.UtcNow),
                result.GetProperty("logStartsAt").ValueKind == JsonValueKind.String ? result.GetProperty("logStartsAt").GetDateTimeOffset() : null,
                result.GetProperty("logMaxBytes").GetInt64());
        });

        // Keep unknown API paths from falling through to the SPA's index.html.
        api.Map("/{**rest}", () => Results.NotFound());
    }
}

public sealed record ConnectionResponse(string Mode, string Target);

public sealed record ServerConfigResponse(
    int WdsUtilExitCode,
    IReadOnlyList<WdsUtilNode> Sections,
    string Raw,
    JsonElement RemoteInstall,
    JsonElement AllowHandsFreeFunctionality);

/// <param name="LogStartsAt">The oldest event in the Operational log: boots before this can't be shown.</param>
public sealed record ActivityResponse(IReadOnlyList<BootSession> Sessions, DateTimeOffset? LogStartsAt, long LogMaxBytes);
