using Microsoft.Extensions.Options;
using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Endpoints;

/// <summary>Uploading, inspecting, importing and managing boot and install images.</summary>
public static class ImageEndpoints
{
    private static readonly TimeSpan InspectTimeout = TimeSpan.FromMinutes(10);

    public static void MapImageEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        // Resumable uploads into the staging folder on the WDS server.
        api.MapGet("/uploads", (UploadStore uploads) => uploads.List());
        api.MapPost("/uploads", (CreateUploadRequest request, UploadStore uploads) =>
        {
            var upload = uploads.Create(request.FileName, request.Size);
            return Results.Created($"/api/uploads/{upload.Id}", upload);
        });
        api.MapGet("/uploads/{id}", (string id, UploadStore uploads) =>
            uploads.Get(id) is { } upload ? Results.Ok(upload) : Results.NotFound());
        api.MapPut("/uploads/{id}", (string id, long offset, HttpRequest request, UploadStore uploads, CancellationToken ct) =>
            uploads.AppendAsync(id, offset, request.Body, ct));
        api.MapDelete("/uploads/{id}", (string id, UploadStore uploads) =>
        {
            uploads.Delete(id);
            return Results.NoContent();
        });

        // Image files already on the WDS server, and what's inside one.
        api.MapGet("/images/files", (WdsScriptRunner wds, IOptions<WdsOptions> options, CancellationToken ct) =>
            wds.RunAsync("Find-ImageFiles", new Dictionary<string, object?>
            {
                ["Roots"] = options.Value.ImageSearchPaths is { Length: > 0 } roots ? roots : WdsOptions.DefaultImageSearchPaths,
            }, timeout: TimeSpan.FromMinutes(2), ct: ct));

        api.MapPost("/images/inspect", (InspectRequest request, WdsScriptRunner wds, CancellationToken ct) =>
            wds.RunAsync("Get-ImageFileInfo", new Dictionary<string, object?>
            {
                ["Path"] = ImportValidation.ServerPath(request.Path),
            }, timeout: InspectTimeout, ct: ct));

        // Imports run in the background, one at a time; the UI polls the job.
        api.MapPost("/images/import", (ImportImageRequest request, UploadStore uploads, ImportQueue queue) =>
        {
            var job = queue.Enqueue(ImportValidation.Validate(request, uploads));
            return Results.Accepted($"/api/jobs/{job.Id}", job);
        });
        api.MapGet("/jobs", (ImportQueue queue) => queue.List());
        api.MapGet("/jobs/{id}", (string id, ImportQueue queue) =>
            queue.Get(id) is { } job ? Results.Ok(job) : Results.NotFound());

        // Enabling, disabling and removing images, and removing empty image groups.
        foreach (var action in new[] { "Enable", "Disable", "Remove" })
        {
            api.MapPost($"/boot-images/{action.ToLowerInvariant()}", (BootImageRef image, WdsScriptRunner wds, CancellationToken ct) =>
                RunActionAsync(wds, "BootImage", action, image.Name, image.Architecture, null, image.FileName, ct));
            api.MapPost($"/install-images/{action.ToLowerInvariant()}", (InstallImageRef image, WdsScriptRunner wds, CancellationToken ct) =>
                RunActionAsync(wds, "InstallImage", action, image.Name, null, image.ImageGroup, image.FileName, ct));
        }
        api.MapPost("/image-groups/remove", (ImageGroupRef group, WdsScriptRunner wds, CancellationToken ct) =>
            RunActionAsync(wds, "ImageGroup", "Remove", group.Name, null, null, null, ct));
    }

    private static async Task<IResult> RunActionAsync(
        WdsScriptRunner wds, string target, string action, string name, string? architecture, string? imageGroup, string? fileName, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new InvalidRequestException("Say which image to change.");
        await wds.RunAsync("Invoke-WdsImageAction", new Dictionary<string, object?>
        {
            ["Target"] = target,
            ["Action"] = action,
            ["Name"] = name,
            ["Architecture"] = architecture,
            ["ImageGroup"] = imageGroup,
            ["FileName"] = fileName,
        }, retryOnBrokenSession: false, ct: ct);
        return Results.NoContent();
    }
}

public sealed record CreateUploadRequest(string FileName, long Size);

public sealed record InspectRequest(string Path);

public sealed record BootImageRef(string Name, string Architecture, string? FileName);

public sealed record InstallImageRef(string Name, string? ImageGroup, string? FileName);

public sealed record ImageGroupRef(string Name);
