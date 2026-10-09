using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

/// <summary>The queue isn't started here, so jobs stay queued: what cancelling and retrying do to them.</summary>
public sealed class ImportQueueTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wdsweb-queue-" + Guid.NewGuid().ToString("N"));
    private readonly ImportQueue _queue;

    public ImportQueueTests()
    {
        var options = Options.Create(new WdsOptions { Mode = WdsConnectionMode.Local, StagingPath = _root });
        var pool = new WdsSessionPool(options, NullLogger<WdsSessionPool>.Instance);
        var staging = new StagingArea(options, pool);
        _queue = new ImportQueue(
            new WdsScriptRunner(pool, options, NullLogger<WdsScriptRunner>.Instance),
            new UploadStore(staging),
            staging,
            NullLogger<ImportQueue>.Instance);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    private static DriverImportRequest Drivers(string? user = "CONTOSO\\jdoe") =>
        new(@"C:\Drivers\nic.zip", "Network", CreateGroup: false, Architecture: "x64", UploadId: null, DeleteUploadAfter: false, RequestedBy: user);

    [Fact]
    public void Cancels_a_job_that_has_not_started()
    {
        var job = _queue.Enqueue(Drivers());

        var cancelled = _queue.Cancel(job.Id, "CONTOSO\\asmith");

        Assert.Equal(JobStatus.Cancelled, cancelled?.Status);
        Assert.NotNull(cancelled?.FinishedAt);
        Assert.Contains(cancelled!.Log, line => line.Text.Contains("CONTOSO\\asmith"));
    }

    [Fact]
    public void Cancels_a_job_only_once()
    {
        var job = _queue.Enqueue(Drivers());
        _queue.Cancel(job.Id, null);

        Assert.Throws<InvalidRequestException>(() => _queue.Cancel(job.Id, null));
    }

    [Fact]
    public void Retries_a_cancelled_job_as_a_new_one_for_whoever_asked()
    {
        var job = _queue.Enqueue(Drivers());
        _queue.Cancel(job.Id, null);

        var retried = _queue.Retry(job.Id, "CONTOSO\\asmith");

        Assert.NotNull(retried);
        Assert.NotEqual(job.Id, retried.Id);
        Assert.Equal(JobStatus.Queued, retried.Status);
        Assert.Equal(Drivers("CONTOSO\\asmith"), retried.Request);
    }

    [Fact]
    public void Retries_only_jobs_that_failed_or_were_cancelled()
    {
        var job = _queue.Enqueue(Drivers());

        Assert.Throws<InvalidRequestException>(() => _queue.Retry(job.Id, null));
    }

    [Fact]
    public void Knows_nothing_of_unknown_jobs()
    {
        Assert.Null(_queue.Cancel("nope", null));
        Assert.Null(_queue.Retry("nope", null));
    }
}
