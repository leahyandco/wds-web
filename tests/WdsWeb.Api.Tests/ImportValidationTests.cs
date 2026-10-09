using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

public sealed class ImportValidationTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wdsweb-tests", Guid.NewGuid().ToString("N"));
    private readonly UploadStore _uploads;

    public ImportValidationTests()
    {
        var options = Options.Create(new WdsOptions { Mode = WdsConnectionMode.Local, StagingPath = _root });
        _uploads = new UploadStore(new StagingArea(options, new WdsSessionPool(options, NullLogger<WdsSessionPool>.Instance)));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    [Theory]
    [InlineData("Windows 11 Pro (25H2)", "windows-11-pro-25h2.wim")]
    [InlineData("  Boot: WinPE x64  ", "boot-winpe-x64.wim")]
    [InlineData("!!!", "image.wim")]
    public void Suggests_wds_friendly_file_names(string name, string expected)
    {
        Assert.Equal(expected, ImportValidation.SuggestFileName(name));
    }

    [Fact]
    public void Accepts_an_install_image_from_an_iso_on_the_server()
    {
        var request = ImportValidation.Validate(
            Request(serverPath: @"C:\ISO\Win11.iso", innerPath: @"\sources\install.wim", kind: ImageKind.Install, group: "Win11", name: "Windows 11 Pro"),
            _uploads);

        Assert.Equal(@"C:\ISO\Win11.iso", request.SourcePath);
        Assert.Equal(@"sources\install.wim", request.InnerPath);
        Assert.Equal("windows-11-pro.wim", request.FileName);
        Assert.Equal("Win11", request.ImageGroup);
    }

    [Fact]
    public async Task Adds_drivers_from_an_uploaded_zip_into_a_new_group()
    {
        var upload = _uploads.Create("Latitude-5450.zip", 3);
        await _uploads.AppendAsync(upload.Id, 0, new MemoryStream([1, 2, 3]), CancellationToken.None);

        var request = ImportValidation.ValidateDrivers(
            new ImportDriversRequest(upload.Id, null, " Latitude 5450 ", CreateGroup: true, "X64", DeleteUploadAfter: true), _uploads, "CONTOSO\\jdoe");

        Assert.Equal(upload.ServerPath, request.SourcePath);
        Assert.Equal(("Latitude 5450", true, "x64", true), (request.DriverGroup, request.CreateGroup, request.Architecture, request.DeleteUploadAfter));
        Assert.Equal(("Latitude-5450.zip", "drivers"), (request.Name, request.Kind));
    }

    [Fact]
    public void Adds_drivers_from_a_folder_on_the_server_into_no_group()
    {
        var request = ImportValidation.ValidateDrivers(new ImportDriversRequest(null, @"C:\Drivers\Intel NIC\", "", true, null, true), _uploads);

        Assert.Equal((@"C:\Drivers\Intel NIC\", "Intel NIC"), (request.SourcePath, request.Name));
        // No group, so nothing to create; and nothing uploaded, so nothing to delete.
        Assert.Equal((null, false, null, false), (request.DriverGroup, request.CreateGroup, request.Architecture, request.DeleteUploadAfter));
    }

    [Fact]
    public void Drivers_are_uploaded_as_a_zip_or_cab()
    {
        var upload = _uploads.Create("boot.wim", 3);

        Assert.Throws<InvalidRequestException>(() => ImportValidation.ValidateDrivers(new ImportDriversRequest(upload.Id, null, null, false, null, false), _uploads));
    }

    [Theory]
    [InlineData(@"Drivers\Dell.zip", null, null)]
    [InlineData(@"C:\Drivers\..\Windows", null, null)]
    [InlineData(@"C:\Drivers\Dell.zip", "Dell/HP", null)]
    [InlineData(@"C:\Drivers\Dell.zip", null, "amd64")]
    public void Refuses_drivers_from_a_bad_path_or_into_a_bad_group(string path, string? group, string? architecture)
    {
        Assert.Throws<InvalidRequestException>(() => ImportValidation.ValidateDrivers(new ImportDriversRequest(null, path, group, true, architecture, false), _uploads));
    }

    [Fact]
    public async Task Takes_the_source_from_a_finished_upload()
    {
        var upload = _uploads.Create("boot.wim", 3);
        await _uploads.AppendAsync(upload.Id, 0, new MemoryStream([1, 2, 3]), CancellationToken.None);

        var request = ImportValidation.Validate(Request(uploadId: upload.Id, deleteAfter: true), _uploads);

        Assert.Equal(upload.ServerPath, request.SourcePath);
        Assert.True(request.DeleteUploadAfter);
    }

    [Fact]
    public void Refuses_an_unfinished_upload()
    {
        var upload = _uploads.Create("boot.wim", 3);

        Assert.Throws<InvalidRequestException>(() => ImportValidation.Validate(Request(uploadId: upload.Id), _uploads));
    }

    [Theory]
    [InlineData(@"relative\boot.wim", null)]
    [InlineData(@"C:\ISO\notes.txt", null)]
    [InlineData(@"C:\ISO\Win11.iso", null)]
    [InlineData(@"C:\ISO\Win11.iso", @"..\..\Windows\boot.wim")]
    [InlineData(@"C:\ISO\Win11.iso", @"sources\setup.exe")]
    public void Refuses_sources_it_cannot_import(string serverPath, string? innerPath)
    {
        Assert.Throws<InvalidRequestException>(() => ImportValidation.Validate(Request(serverPath: serverPath, innerPath: innerPath), _uploads));
    }

    [Theory]
    [InlineData("boot.exe")]
    [InlineData(@"..\boot.wim")]
    [InlineData("boot image.wim")]
    public void Refuses_unsafe_file_names(string fileName)
    {
        Assert.Throws<InvalidRequestException>(() => ImportValidation.Validate(Request(fileName: fileName), _uploads));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("a/b")]
    public void Requires_a_valid_group_for_install_images(string? group)
    {
        Assert.Throws<InvalidRequestException>(() => ImportValidation.Validate(Request(kind: ImageKind.Install, group: group), _uploads));
    }

    private static ImportImageRequest Request(
        string? uploadId = null,
        string? serverPath = @"C:\Images\boot.wim",
        string? innerPath = null,
        ImageKind kind = ImageKind.Boot,
        string? group = null,
        string? name = "Test image",
        string? fileName = null,
        bool deleteAfter = false) =>
        new(uploadId, uploadId is null ? serverPath : null, innerPath, kind, 1, group, false, name, null, fileName, deleteAfter);
}
