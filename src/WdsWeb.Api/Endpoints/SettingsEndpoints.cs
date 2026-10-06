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
    }
}
