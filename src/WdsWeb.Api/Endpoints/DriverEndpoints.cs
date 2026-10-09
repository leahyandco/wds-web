using Microsoft.Extensions.Options;
using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Endpoints;

/// <summary>Adding drivers to the WDS driver store, and managing its driver groups and packages.</summary>
public static class DriverEndpoints
{
    /// <summary>A batch runs WDSUTIL once a package, a second or so each.</summary>
    private static readonly TimeSpan BatchTimeout = TimeSpan.FromMinutes(15);

    public static void MapDriverEndpoints(this IEndpointRouteBuilder app)
    {
        var drivers = app.MapGroup("/api/drivers");

        // Adding drivers runs in the background, in the same queue as image imports.
        drivers.MapPost("/import", (ImportDriversRequest request, HttpContext http, UploadStore uploads, StagingArea staging, ImportQueue queue) =>
        {
            if (staging.IsDemo) throw new InvalidRequestException(Wds.Demo.DemoWds.NothingChanges);
            var job = queue.Enqueue(ImportValidation.ValidateDrivers(request, uploads, http.User.Identity?.Name));
            return Results.Accepted($"/api/jobs/{job.Id}", job);
        });

        // Writing packages into a boot image takes minutes each, so it's a job too.
        app.MapPost("/api/boot-images/drivers", (AddBootImageDriversRequest request, HttpContext http, StagingArea staging, ImportQueue queue) =>
        {
            if (staging.IsDemo) throw new InvalidRequestException(Wds.Demo.DemoWds.NothingChanges);
            var job = queue.Enqueue(ImportValidation.ValidateBootImageDrivers(request, http.User.Identity?.Name));
            return Results.Accepted($"/api/jobs/{job.Id}", job);
        });

        // .zip and .cab files of drivers already on the WDS server.
        drivers.MapGet("/files", (WdsScriptRunner wds, IOptions<WdsOptions> options, CancellationToken ct) =>
            wds.RunAsync("Find-ImageFiles", new Dictionary<string, object?>
            {
                ["Roots"] = options.Value.DriverSearchPaths is { Length: > 0 } roots ? roots : WdsOptions.DefaultDriverSearchPaths,
                ["Extensions"] = new[] { ".zip", ".cab" },
            }, timeout: TimeSpan.FromMinutes(2), ct: ct));

        drivers.MapPost("/groups", (NewDriverGroup group, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync([WdsDriverCommands.AddGroup(group)], ct));
        drivers.MapPut("/groups/{name}", async (string name, DriverGroupChanges changes, WdsScriptRunner wds, CancellationToken ct) =>
        {
            // WDSUTIL only removes filter types a group has, so changing them needs the ones it has now.
            IReadOnlyList<DriverGroupFilter> current = [];
            if (changes.Filters is not null)
            {
                var group = await wds.RunAsync("Get-DriverGroup", new Dictionary<string, object?> { ["Name"] = WdsDriverCommands.GroupName(name) }, ct: ct);
                current = WdsUtilDriverParser.ParseGroups(group.GetProperty("report").GetString() ?? "").FirstOrDefault()?.Filters ?? [];
            }
            return await wds.RunWdsUtilAsync(WdsDriverCommands.ChangeGroup(name, changes, current), ct);
        });
        drivers.MapDelete("/groups/{name}", (string name, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync([WdsDriverCommands.RemoveGroup(name)], ct));

        drivers.MapPut("/packages/{id}", (string id, DriverPackageChanges changes, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync([WdsDriverCommands.ChangePackage(id, changes)], ct));
        drivers.MapDelete("/packages/{id}", (string id, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync([WdsDriverCommands.RemovePackage(id)], ct));
        drivers.MapPost("/packages/batch", (DriverPackageBatch batch, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunWdsUtilAsync(WdsDriverCommands.Batch(batch), ct, BatchTimeout));
    }
}
