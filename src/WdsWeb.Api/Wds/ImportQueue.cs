using System.Collections.Concurrent;
using System.Management.Automation;
using System.Text.Json;
using System.Threading.Channels;

namespace WdsWeb.Api.Wds;

public enum ImageKind { Boot, Install }

public enum JobStatus { Queued, Running, Succeeded, Failed }

/// <param name="SourcePath">The .wim, .esd or .iso, as a path on the WDS server.</param>
/// <param name="InnerPath">For an ISO, the image file inside it, e.g. sources\install.wim.</param>
/// <param name="Index">Which image in the file (1-based).</param>
/// <param name="UploadId">The upload the source came from, if any, so it can be deleted afterwards.</param>
/// <param name="RequestedBy">The signed-in user who asked for the import.</param>
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
    string? RequestedBy = null);

public sealed record JobLogLine(DateTimeOffset Time, string Text);

public sealed record ImportJobView(
    string Id,
    ImportRequest Request,
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
/// Runs image imports one at a time, in the order they were asked for. WDS handles one import at a
/// time best, and each can take many minutes, so an import runs here in the background and the
/// UI follows it through <see cref="Get"/>. Jobs are kept in memory, so a restart forgets them.
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

    public ImportJobView Enqueue(ImportRequest request)
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

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in _pending.Reader.ReadAllAsync(stoppingToken))
            await RunAsync(job, stoppingToken);
    }

    private async Task RunAsync(Job job, CancellationToken ct)
    {
        var request = job.Request;
        job.Start();
        if (request.RequestedBy is not null) job.Message($"Requested by {request.RequestedBy}");
        logger.LogInformation("Importing {Kind} image {Name} from {Source} for {User}", request.Kind, request.Name, request.SourcePath, request.RequestedBy);
        try
        {
            var result = await wds.RunJobAsync("Import-WdsImage", new Dictionary<string, object?>
            {
                ["Path"] = request.SourcePath,
                ["InnerPath"] = request.InnerPath,
                ["Kind"] = request.Kind.ToString(),
                ["Index"] = request.Index,
                ["ImageGroup"] = request.ImageGroup,
                ["CreateGroup"] = request.CreateGroup,
                ["Name"] = request.Name,
                ["Description"] = request.Description,
                ["FileName"] = request.FileName,
                ["TempFolder"] = staging.ToServerPath(Path.Combine(staging.TempFolder, job.Id)),
            }, job.Message, job.Progress, ct);

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
            job.Succeed(result);
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

    private sealed class Job(string id, ImportRequest request)
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
        public ImportRequest Request { get; } = request;
        public DateTimeOffset CreatedAt { get; } = DateTimeOffset.UtcNow;
        public bool IsFinished { get { lock (_lock) return _status is JobStatus.Succeeded or JobStatus.Failed; } }

        public void Start()
        {
            lock (_lock)
            {
                _status = JobStatus.Running;
                _stage = "Starting";
                _startedAt = DateTimeOffset.UtcNow;
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

        public void Succeed(JsonElement result)
        {
            lock (_lock)
            {
                _status = JobStatus.Succeeded;
                _stage = "Imported";
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
