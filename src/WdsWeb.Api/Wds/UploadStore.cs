using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace WdsWeb.Api.Wds;

public sealed record UploadInfo(string Id, string FileName, long Size, long Received, DateTimeOffset CreatedAt, string ServerPath)
{
    public bool Complete => Received >= Size;
}

/// <summary>A chunk arrived for the wrong offset; <see cref="Received"/> says where to carry on from.</summary>
public sealed class UploadOffsetException(long received)
    : Exception($"The upload has {received:N0} bytes; send the next chunk from there.")
{
    public long Received { get; } = received;
}

/// <summary>
/// Resumable uploads into the staging folder. A client creates an upload, then sends the file in
/// chunks at increasing offsets; after a failed chunk it asks for the current length and carries
/// on. Each upload is a folder holding upload.json and the file, with ".part" on the end of its
/// name until the last byte arrives.
/// </summary>
public sealed partial class UploadStore(StagingArea staging)
{
    public static readonly string[] AllowedExtensions = [".iso", ".wim", ".esd"];
    private const long MaximumSize = 64L * 1024 * 1024 * 1024;
    private const long KeepFree = 2L * 1024 * 1024 * 1024;
    private const string PartSuffix = ".part";

    private readonly ConcurrentDictionary<string, SemaphoreSlim> _writers = new();

    public UploadInfo Create(string fileName, long size)
    {
        fileName = fileName.Trim();
        if (fileName.Length is 0 or > 200 || Path.GetFileName(fileName) != fileName || fileName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            throw new InvalidRequestException($"\"{fileName}\" isn't a usable file name.");
        if (!AllowedExtensions.Contains(Path.GetExtension(fileName), StringComparer.OrdinalIgnoreCase))
            throw new InvalidRequestException($"Only {string.Join(", ", AllowedExtensions)} files can be uploaded.");
        if (size is <= 0 or > MaximumSize)
            throw new InvalidRequestException("The file size must be between 1 byte and 64 GB.");

        var (free, _) = staging.GetSpace();
        if (free - size < KeepFree)
            throw new InvalidRequestException(
                $"There isn't room on the WDS server: the file needs {Format(size)} and {Format(free)} is free, " +
                $"and at least {Format(KeepFree)} has to stay free.");

        var id = Guid.NewGuid().ToString("N");
        var folder = Folder(id);
        Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(folder, "upload.json"), JsonSerializer.Serialize(new Manifest(fileName, size, DateTimeOffset.UtcNow)));
        File.Create(Path.Combine(folder, fileName + PartSuffix)).Dispose();
        return Get(id)!;
    }

    public UploadInfo? Get(string id)
    {
        if (!IdPattern().IsMatch(id)) return null;
        var manifestPath = Path.Combine(Folder(id), "upload.json");
        if (!File.Exists(manifestPath)) return null;

        var manifest = JsonSerializer.Deserialize<Manifest>(File.ReadAllText(manifestPath))!;
        var final = Path.Combine(Folder(id), manifest.FileName);
        var part = final + PartSuffix;
        var received = File.Exists(final) ? new FileInfo(final).Length : File.Exists(part) ? new FileInfo(part).Length : 0;
        return new UploadInfo(id, manifest.FileName, manifest.Size, received, manifest.CreatedAt, staging.ToServerPath(final));
    }

    public IReadOnlyList<UploadInfo> List()
    {
        staging.EnsureReady();
        if (!Directory.Exists(staging.UploadsFolder)) return [];
        return Directory.EnumerateDirectories(staging.UploadsFolder)
            .Select(d => Get(Path.GetFileName(d)))
            .OfType<UploadInfo>()
            .OrderByDescending(u => u.CreatedAt)
            .ToList();
    }

    /// <summary>Appends a chunk that starts at <paramref name="offset"/>, which must be the length so far.</summary>
    public async Task<UploadInfo> AppendAsync(string id, long offset, Stream content, CancellationToken ct)
    {
        var writer = _writers.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
        await writer.WaitAsync(ct);
        try
        {
            var upload = Get(id) ?? throw new KeyNotFoundException($"There's no upload {id}.");
            if (upload.Complete || offset != upload.Received) throw new UploadOffsetException(upload.Received);

            var final = Path.Combine(Folder(id), upload.FileName);
            var part = final + PartSuffix;
            var remaining = upload.Size - offset;
            await using (var file = new FileStream(part, FileMode.Append, FileAccess.Write, FileShare.Read, 1 << 20, useAsync: true))
            {
                var buffer = new byte[1 << 20];
                long written = 0;
                int read;
                while ((read = await content.ReadAsync(buffer, ct)) > 0)
                {
                    if (written + read > remaining)
                    {
                        file.SetLength(offset);
                        throw new InvalidRequestException("The chunk runs past the end of the file.");
                    }
                    await file.WriteAsync(buffer.AsMemory(0, read), ct);
                    written += read;
                }
            }

            if (new FileInfo(part).Length == upload.Size) File.Move(part, final);
            return Get(id)!;
        }
        finally
        {
            writer.Release();
        }
    }

    public void Delete(string id)
    {
        if (Get(id) is null) throw new KeyNotFoundException($"There's no upload {id}.");
        Directory.Delete(Folder(id), recursive: true);
        _writers.TryRemove(id, out _);
    }

    private string Folder(string id)
    {
        staging.EnsureReady();
        return Path.Combine(staging.UploadsFolder, id);
    }

    private static string Format(long bytes) => $"{bytes / (1024.0 * 1024 * 1024):N1} GB";

    [GeneratedRegex("^[0-9a-f]{32}$")]
    private static partial Regex IdPattern();

    private sealed record Manifest(string FileName, long Size, DateTimeOffset CreatedAt);
}
