using System.Collections.Concurrent;
using System.Management.Automation;
using System.Text.Json;
using System.Threading.Channels;

namespace WdsWeb.Api.Wds;

public enum ImageKind { Boot, Install }

public enum JobStatus { Queued, Running, Succeeded, Failed, Cancelled }

/// <summary>Something the queue imports: an image, or drivers.</summary>
public interface IImportRequest
{
    /// <summary>What the import is called in the job list.</summary>
    string Name { get; }

    /// <summary>The upload the source came from, if any, so it can be deleted afterwards.</summary>
    string? UploadId { get; }

    bool DeleteUploadAfter { get; }

    /// <summary>The signed-in user who asked for the import.</summary>
    string? RequestedBy { get; }
}

/// <param name="SourcePath">The .wim, .esd or .iso, as a path on the WDS server.</param>
/// <param name="InnerPath">For an ISO, the image file inside it, e.g. sources\install.wim.</param>
/// <param name="Index">Which image in the file (1-based).</param>
public sealed record ImportRequest(
    string SourcePath,
    string? InnerPath,
    ImageKind Kind,
    int Index,
    string? ImageGroup,
    bool CreateGroup,
    string Name,
    string? Description,
    string FileName,
    string? UploadId,
    bool DeleteUploadAfter,
    string? RequestedBy = null) : IImportRequest;

/// <param name="SourcePath">A .zip or .cab of drivers, a folder of them, or one .inf, as a path on the WDS server.</param>
/// <param name="DriverGroup">The driver group to put the packages in, if any.</param>
/// <param name="CreateGroup">Create the driver group if there's none of that name.</param>
/// <param name="Architecture">Only add drivers for this architecture (x86, x64, arm or arm64); null for all.</param>
public sealed record DriverImportRequest(
    string SourcePath,
    string? DriverGroup,
    bool CreateGroup,
    string? Architecture,
    string? UploadId,
    bool DeleteUploadAfter,
    string? RequestedBy = null) : IImportRequest
{
    /// <summary>Tells drivers apart in the job list, as an image import's kind says boot or install.</summary>
    public string Kind => "drivers";

    /// <summary>The file or folder the drivers come from.</summary>
    public string Name => Path.GetFileName(SourcePath.TrimEnd('\\')) is { Length: > 0 } name ? name : SourcePath;
}

/// <summary>
/// Driver packages from the store to write into a boot image (WinPE), such as network and storage drivers
/// it lacks. WDS mounts and saves the image for each one, and can't take them out again.
/// </summary>
/// <param name="ImageName">The boot image, with its architecture and, where the name isn't unique, its file name.</param>
public sealed record BootImageDriversRequest(
    string ImageName,
    string Architecture,
    string? FileName,
    IReadOnlyList<string> PackageIds,
    string? RequestedBy = null) : IImportRequest
{
    public string Kind => "boot-drivers";
    public string Name => ImageName;
    public string? UploadId => null;
    public bool DeleteUploadAfter => false;
}

public sealed record JobLogLine(DateTimeOffset Time, string Text);

/// <param name="Request">An <see cref="ImportRequest"/> or a <see cref="DriverImportRequest"/>, as itself.</param>
public sealed record ImportJobView(
    string Id,
    object Request,
    JobStatus Status,
    string? Stage,
    int? Percent,
    DateTimeOffset CreatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? FinishedAt,
    string? Error,
    IReadOnlyList<JobLogLine> Log,
    JsonElement? Result);

/// <summary>
/// Runs image and driver imports one at a time, in the order they were asked for. WDS handles one
/// import at a time best, and each can take many minutes, so an import runs here in the background and
/// the UI follows it through <see cref="Get"/>. Jobs are kept in memory, so a restart forgets them.
/// </summary>
public sealed class ImportQueue(
    WdsScriptRunner wds,
    UploadStore uploads,
    StagingArea staging,
    ILogger<ImportQueue> logger) : BackgroundService
{
    private const int KeepFinished = 50;
    private readonly Channel<Job> _pending = Channel.CreateUnbounded<Job>();
    private readonly ConcurrentDictionary<string, Job> _jobs = new();

    public ImportJobView Enqueue(IImportRequest request)
    {
        var job = new Job(Guid.NewGuid().ToString("N"), request);
        _jobs[job.Id] = job;
        _pending.Writer.TryWrite(job);
        Prune();
        return job.View();
    }

    public IReadOnlyList<ImportJobView> List() =>
        _jobs.Values.OrderByDescending(j => j.CreatedAt).Select(j => j.View()).ToList();

    public ImportJobView? Get(string id) => _jobs.TryGetValue(id, out var job) ? job.View() : null;

    /// <summary>
    /// Takes a job off the queue before it starts. One already running isn't stopped: WDS would be left
    /// halfway through changing an image or the driver store.
    /// </summary>
    /// <returns>The job as it is now; null if there's none with that ID.</returns>
    public ImportJobView? Cancel(string id, string? cancelledBy)
    {
        if (!_jobs.TryGetValue(id, out var job)) return null;
        if (!job.TryCancel(cancelledBy)) throw new InvalidRequestException("Only an import that hasn't started yet can be cancelled.");
        logger.LogInformation("Cancelled the import of {Name} for {User}", job.Request.Name, cancelledBy);
        return job.View();
    }

    /// <summary>Queues a failed or cancelled job's import again, as a new job asked for by <paramref name="requestedBy"/>.</summary>
    /// <returns>The new job; null if there's no job with that ID.</returns>
    public ImportJobView? Retry(string id, string? requestedBy)
    {
        if (!_jobs.TryGetValue(id, out var job)) return null;
        if (!job.CanRetry) throw new InvalidRequestException("Only an import that failed or was cancelled can be tried again.");
        return Enqueue(job.Request switch
        {
            ImportRequest image => image with { RequestedBy = requestedBy },
            DriverImportRequest drivers => drivers with { RequestedBy = requestedBy },
            BootImageDriversRequest boot => boot with { RequestedBy = requestedBy },
            var other => other,
        });
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in _pending.Reader.ReadAllAsync(stoppingToken))
            await RunAsync(job, stoppingToken);
    }

    private async Task RunAsync(Job job, CancellationToken ct)
    {
        var request = job.Request;
        // Cancelled while it waited.
        if (!job.TryStart()) return;
        if (request.RequestedBy is not null) job.Message($"Requested by {request.RequestedBy}");
        var tempFolder = staging.ToServerPath(Path.Combine(staging.TempFolder, job.Id));
        try
        {
            JsonElement result;
            string? summary = null;
            switch (request)
            {
                case ImportRequest image:
                    logger.LogInformation("Importing {Kind} image {Name} from {Source} for {User}", image.Kind, image.Name, image.SourcePath, image.RequestedBy);
                    result = await wds.RunJobAsync("Import-WdsImage", new Dictionary<string, object?>
                    {
                        ["Path"] = image.SourcePath,
                        ["InnerPath"] = image.InnerPath,
                        ["Kind"] = image.Kind.ToString(),
                        ["Index"] = image.Index,
                        ["ImageGroup"] = image.ImageGroup,
                        ["CreateGroup"] = image.CreateGroup,
                        ["Name"] = image.Name,
                        ["Description"] = image.Description,
                        ["FileName"] = image.FileName,
                        ["TempFolder"] = tempFolder,
                    }, job.Message, job.Progress, ct);
                    break;

                case DriverImportRequest drivers:
                    logger.LogInformation("Adding drivers from {Source} to {Group} for {User}", drivers.SourcePath, drivers.DriverGroup ?? "no group", drivers.RequestedBy);
                    result = await wds.RunJobAsync("Import-WdsDrivers", new Dictionary<string, object?>
                    {
                        ["Path"] = drivers.SourcePath,
                        ["DriverGroup"] = drivers.DriverGroup,
                        ["CreateGroup"] = drivers.CreateGroup,
                        ["Architecture"] = drivers.Architecture ?? "",
                        ["TempFolder"] = tempFolder,
                    }, job.Message, job.Progress, ct);
                    summary = result.TryGetProperty("summary", out var said) ? said.GetString() : null;
                    break;

                case BootImageDriversRequest boot:
                    logger.LogInformation("Adding {Count} driver packages to boot image {Image} for {User}", boot.PackageIds.Count, boot.ImageName, boot.RequestedBy);
                    result = await wds.RunJobAsync("Add-WdsBootImageDrivers", new Dictionary<string, object?>
                    {
                        ["ImageName"] = boot.ImageName,
                        ["Architecture"] = boot.Architecture,
                        ["FileName"] = boot.FileName,
                        ["PackageIds"] = boot.PackageIds.ToArray(),
                    }, job.Message, job.Progress, ct);
                    summary = result.TryGetProperty("summary", out var bootSaid) ? bootSaid.GetString() : null;
                    break;

                default:
                    throw new InvalidOperationException($"There's no import for {request.GetType().Name}.");
            }

            if (request.DeleteUploadAfter && request.UploadId is { } uploadId)
            {
                try
                {
                    uploads.Delete(uploadId);
                    job.Message("Deleted the uploaded file from the staging folder");
                }
                catch (Exception ex)
                {
                    job.Message($"Couldn't delete the uploaded file: {ex.Message}");
                }
            }
            job.Succeed(result, summary);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Import of {Name} failed", request.Name);
            job.Fail(ex.Message);
        }
    }

    private void Prune()
    {
        foreach (var old in _jobs.Values.Where(j => j.IsFinished).OrderByDescending(j => j.CreatedAt).Skip(KeepFinished))
            _jobs.TryRemove(old.Id, out _);
    }

    private sealed class Job(string id, IImportRequest request)
    {
        private readonly Lock _lock = new();
        private readonly List<JobLogLine> _log = [];
        private JobStatus _status = JobStatus.Queued;
        private string? _stage = "Waiting for earlier imports";
        private int? _percent;
        private DateTimeOffset? _startedAt, _finishedAt;
        private string? _error;
        private JsonElement? _result;

        public string Id { get; } = id;
        public IImportRequest Request { get; } = request;
        public DateTimeOffset CreatedAt { get; } = DateTimeOffset.UtcNow;
        public bool IsFinished { get { lock (_lock) return _status is JobStatus.Succeeded or JobStatus.Failed or JobStatus.Cancelled; } }

        public bool CanRetry { get { lock (_lock) return _status is JobStatus.Failed or JobStatus.Cancelled; } }

        /// <returns>False if the job was cancelled before its turn came.</returns>
        public bool TryStart()
        {
            lock (_lock)
            {
                if (_status != JobStatus.Queued) return false;
                _status = JobStatus.Running;
                _stage = "Starting";
                _startedAt = DateTimeOffset.UtcNow;
                return true;
            }
        }

        /// <returns>False if the job has started (or finished) already.</returns>
        public bool TryCancel(string? cancelledBy)
        {
            lock (_lock)
            {
                if (_status != JobStatus.Queued) return false;
                _status = JobStatus.Cancelled;
                _stage = "Cancelled";
                _log.Add(new JobLogLine(DateTimeOffset.UtcNow, cancelledBy is null ? "Cancelled before it started" : $"Cancelled by {cancelledBy} before it started"));
                _finishedAt = DateTimeOffset.UtcNow;
                return true;
            }
        }

        public void Message(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            lock (_lock)
            {
                _log.Add(new JobLogLine(DateTimeOffset.UtcNow, text));
                _stage = text;
                _percent = null;
            }
        }

        public void Progress(ProgressRecord record)
        {
            lock (_lock)
            {
                _percent = record.PercentComplete is >= 0 and <= 100 ? record.PercentComplete : null;
                if (!string.IsNullOrWhiteSpace(record.Activity)) _stage = record.Activity;
            }
        }

        /// <param name="summary">What came of it, if more than that it's imported.</param>
        public void Succeed(JsonElement result, string? summary = null)
        {
            lock (_lock)
            {
                _status = JobStatus.Succeeded;
                _stage = summary ?? "Imported";
                _percent = 100;
                _result = result;
                _finishedAt = DateTimeOffset.UtcNow;
            }
        }

        public void Fail(string error)
        {
            lock (_lock)
            {
                _status = JobStatus.Failed;
                _stage = "Failed";
                _error = error;
                _log.Add(new JobLogLine(DateTimeOffset.UtcNow, error));
                _finishedAt = DateTimeOffset.UtcNow;
            }
        }

        public ImportJobView View()
        {
            lock (_lock)
            {
                return new ImportJobView(Id, Request, _status, _stage, _percent, CreatedAt, _startedAt, _finishedAt, _error, _log.ToList(), _result);
            }
        }
    }
}
