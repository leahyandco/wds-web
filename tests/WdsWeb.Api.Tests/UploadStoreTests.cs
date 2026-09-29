using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

public sealed class UploadStoreTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wdsweb-tests", Guid.NewGuid().ToString("N"));
    private readonly UploadStore _store;

    public UploadStoreTests()
    {
        var options = Options.Create(new WdsOptions { Mode = WdsConnectionMode.Local, StagingPath = _root });
        var pool = new WdsSessionPool(options, NullLogger<WdsSessionPool>.Instance);
        _store = new UploadStore(new StagingArea(options, pool));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    [Fact]
    public async Task Assembles_a_file_from_chunks_and_names_it_once_complete()
    {
        var upload = _store.Create("boot.wim", 10);

        var afterFirst = await _store.AppendAsync(upload.Id, 0, Bytes(0, 6), CancellationToken.None);
        Assert.Equal((6L, false), (afterFirst.Received, afterFirst.Complete));
        Assert.False(File.Exists(upload.ServerPath));

        var done = await _store.AppendAsync(upload.Id, 6, Bytes(6, 4), CancellationToken.None);
        Assert.True(done.Complete);
        Assert.Equal(Enumerable.Range(0, 10).Select(i => (byte)i), File.ReadAllBytes(done.ServerPath));
    }

    [Fact]
    public async Task Rejects_a_chunk_for_the_wrong_offset_and_says_where_to_resume()
    {
        var upload = _store.Create("boot.wim", 10);
        await _store.AppendAsync(upload.Id, 0, Bytes(0, 4), CancellationToken.None);

        var conflict = await Assert.ThrowsAsync<UploadOffsetException>(() => _store.AppendAsync(upload.Id, 2, Bytes(2, 4), CancellationToken.None));

        Assert.Equal(4, conflict.Received);
    }

    [Fact]
    public async Task Refuses_data_past_the_declared_size_without_keeping_any_of_it()
    {
        var upload = _store.Create("boot.wim", 10);
        await _store.AppendAsync(upload.Id, 0, Bytes(0, 8), CancellationToken.None);

        await Assert.ThrowsAsync<InvalidRequestException>(() => _store.AppendAsync(upload.Id, 8, Bytes(8, 5), CancellationToken.None));

        Assert.Equal(8, _store.Get(upload.Id)!.Received);
    }

    [Fact]
    public void Lists_and_deletes_uploads()
    {
        var upload = _store.Create("install.iso", 100);

        Assert.Equal([upload.Id], _store.List().Select(u => u.Id));
        _store.Delete(upload.Id);
        Assert.Empty(_store.List());
        Assert.Null(_store.Get(upload.Id));
    }

    [Theory]
    [InlineData(@"..\evil.wim")]
    [InlineData(@"C:\Windows\boot.wim")]
    [InlineData("notes.txt")]
    [InlineData("")]
    public void Rejects_names_that_are_not_image_files(string fileName)
    {
        Assert.Throws<InvalidRequestException>(() => _store.Create(fileName, 10));
    }

    [Fact]
    public void Rejects_a_file_bigger_than_the_free_space()
    {
        var tooBig = Assert.Throws<InvalidRequestException>(() => _store.Create("huge.iso", 60L * 1024 * 1024 * 1024 * 1024));

        Assert.Contains("64 GB", tooBig.Message);
    }

    [Theory]
    [InlineData("../../etc")]
    [InlineData("0123")]
    public void Ignores_ids_that_are_not_upload_ids(string id)
    {
        Assert.Null(_store.Get(id));
    }

    private static MemoryStream Bytes(int start, int count) =>
        new(Enumerable.Range(start, count).Select(i => (byte)i).ToArray());
}
