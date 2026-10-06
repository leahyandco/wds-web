using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Endpoints;

/// <summary>Prestaging, changing and removing devices, and approving or rejecting pending-device requests.</summary>
public static class DeviceEndpoints
{
    public static void MapDeviceEndpoints(this IEndpointRouteBuilder app)
    {
        var devices = app.MapGroup("/api/devices");

        devices.MapPost("", (NewDevice device, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync([WdsDeviceCommands.Add(device)], ct));
        devices.MapPut("/{name}", (string name, DeviceChanges changes, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync([WdsDeviceCommands.Change(name, changes)], ct));
        devices.MapDelete("/{name}", (string name, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync([WdsDeviceCommands.Remove(name)], ct));

        devices.MapPost("/requests/{id}/approve", (uint id, DeviceApproval approval, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync([WdsDeviceCommands.Approve(id, approval)], ct));
        devices.MapPost("/requests/{id}/reject", (uint id, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync([WdsDeviceCommands.Reject(id)], ct));
    }
}
