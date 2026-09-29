using System.Text.RegularExpressions;

namespace WdsWeb.Api.Wds;

/// <summary>An import as the UI asks for it: from an upload, or from a file already on the WDS server.</summary>
public sealed record ImportImageRequest(
    string? UploadId,
    string? ServerPath,
    string? InnerPath,
    ImageKind Kind,
    int Index,
    string? ImageGroup,
    bool CreateGroup,
    string? Name,
    string? Description,
    string? FileName,
    bool DeleteUploadAfter);

/// <summary>Turns what the UI asked for into an <see cref="ImportRequest"/>, or explains what's wrong with it.</summary>
public static partial class ImportValidation
{
    public static ImportRequest Validate(ImportImageRequest request, UploadStore uploads)
    {
        string sourcePath;
        if (!string.IsNullOrWhiteSpace(request.UploadId))
        {
            var upload = uploads.Get(request.UploadId) ?? throw new InvalidRequestException("That upload no longer exists.");
            if (!upload.Complete) throw new InvalidRequestException("That upload hasn't finished yet.");
            sourcePath = upload.ServerPath;
        }
        else
        {
            sourcePath = ServerPath(request.ServerPath);
        }

        var extension = Path.GetExtension(sourcePath).ToLowerInvariant();
        if (extension is not (".wim" or ".esd" or ".iso"))
            throw new InvalidRequestException("Images can be imported from .wim, .esd and .iso files.");

        string? innerPath = null;
        if (extension == ".iso")
        {
            innerPath = request.InnerPath?.Trim().TrimStart('\\');
            if (string.IsNullOrEmpty(innerPath) || innerPath.Contains("..", StringComparison.Ordinal) || Path.IsPathRooted(innerPath) ||
                !(innerPath.EndsWith(".wim", StringComparison.OrdinalIgnoreCase) || innerPath.EndsWith(".esd", StringComparison.OrdinalIgnoreCase)))
                throw new InvalidRequestException("Say which .wim or .esd file inside the ISO to import.");
        }

        if (request.Index < 1) throw new InvalidRequestException("Choose which image in the file to import.");

        var name = request.Name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > 128) throw new InvalidRequestException("Give the image a name of up to 128 characters.");

        var fileName = string.IsNullOrWhiteSpace(request.FileName) ? SuggestFileName(name) : request.FileName.Trim();
        if (!FileNamePattern().IsMatch(fileName))
            throw new InvalidRequestException("The file name must end in .wim and use only letters, numbers, dots, dashes and underscores.");

        string? group = null;
        if (request.Kind == ImageKind.Install)
        {
            group = request.ImageGroup?.Trim();
            if (string.IsNullOrEmpty(group) || group.Length > 64 || group.IndexOfAny(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) >= 0)
                throw new InvalidRequestException("Choose an image group, or name a new one of up to 64 characters without \\ / : * ? \" < > |.");
        }

        var description = request.Description?.Trim();
        return new ImportRequest(
            sourcePath, innerPath, request.Kind, request.Index, group, request.CreateGroup, name,
            string.IsNullOrEmpty(description) ? null : description, fileName,
            string.IsNullOrWhiteSpace(request.UploadId) ? null : request.UploadId,
            request.DeleteUploadAfter && !string.IsNullOrWhiteSpace(request.UploadId));
    }

    /// <summary>A full path on the WDS server, such as C:\ISO\Win11.iso, or a UNC path it can reach.</summary>
    public static string ServerPath(string? path)
    {
        path = path?.Trim().Trim('"');
        if (string.IsNullOrEmpty(path) || !Path.IsPathFullyQualified(path) || path.Contains("..", StringComparison.Ordinal))
            throw new InvalidRequestException(@"Give the full path of a file on the WDS server, such as C:\ISO\Windows11.iso.");
        return path;
    }

    /// <summary>A WDS-friendly file name from an image name: "Windows 11 Pro (25H2)" becomes windows-11-pro-25h2.wim.</summary>
    public static string SuggestFileName(string name)
    {
        var slug = NonAlphanumeric().Replace(name.ToLowerInvariant(), "-").Trim('-');
        if (slug.Length > 60) slug = slug[..60].TrimEnd('-');
        return (slug.Length > 0 ? slug : "image") + ".wim";
    }

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.wim$")]
    private static partial Regex FileNamePattern();

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonAlphanumeric();
}
