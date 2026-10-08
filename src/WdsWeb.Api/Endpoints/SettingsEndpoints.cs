using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Endpoints;

/// <summary>Changing server settings, one form at a time, and restarting the WDS service.</summary>
public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        var settings = app.MapGroup("/api/server/settings");

        settings.MapPut("/pxe", (PxeSettings request, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync(WdsSettingsCommands.For(request), ct));
        settings.MapPut("/boot", (BootDefaultsSettings request, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync(WdsSettingsCommands.For(request), ct));
        settings.MapPut("/client", (ClientSettings request, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync(WdsSettingsCommands.For(request), ct));
        settings.MapPut("/pending-devices", (PendingDeviceSettings request, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync(WdsSettingsCommands.For(request), ct));
        settings.MapPut("/bind", (BindSettings request, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync(WdsSettingsCommands.For(request), ct));
        settings.MapPut("/transport", (TransportSettings request, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync(WdsSettingsCommands.For(request), ct));

        app.MapPost("/api/server/restart", (WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunAsync("Restart-WdsService", retryOnBrokenSession: false, timeout: TimeSpan.FromMinutes(3), ct: ct));

        // The CVE-2026-0386 override, a registry value rather than a WDSUTIL setting.
        app.MapPut("/api/server/hands-free", (HandsFreeSetting request, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunAsync("Set-WdsHandsFree", new Dictionary<string, object?> { ["Allow"] = request.Allow }, retryOnBrokenSession: false, ct: ct));
    }
}

/// <param name="Allow">True lets clients fetch the WDS client unattend file without authenticating (insecure).</param>
public sealed record HandsFreeSetting(bool Allow);
