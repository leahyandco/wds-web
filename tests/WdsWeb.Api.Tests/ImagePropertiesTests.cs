using System.Text.Json;
using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

public class ImagePropertiesTests
{
    private const string Unattend = """
        <?xml version="1.0" encoding="utf-8"?>
        <unattend xmlns="urn:schemas-microsoft-com:unattend">
          <settings pass="oobeSystem" />
        </unattend>
        """;

    [Fact]
    public void Boot_image_changes_pass_only_what_was_given()
    {
        var parameters = ImageProperties.For(new BootImageChanges(" WinPE ", "x64", "boot.wim", NewDescription: " Recovery tools ", DisplayOrder: 100));

        Assert.Equal(
            new Dictionary<string, object?>
            {
                ["Target"] = "BootImage",
                ["Name"] = "WinPE",
                ["FileName"] = "boot.wim",
                ["Architecture"] = "x64",
                ["NewDescription"] = "Recovery tools",
                ["DisplayOrder"] = 100L,
            },
            parameters);
    }

    [Fact]
    public void A_change_must_change_something()
    {
        Assert.Throws<InvalidRequestException>(() => ImageProperties.For(new BootImageChanges("WinPE", "x64", null)));
        Assert.Throws<InvalidRequestException>(() => ImageProperties.For(new InstallImageChanges("Windows 11 Pro", "Win11", null)));
    }

    [Theory]
    [InlineData("", null, null)]
    [InlineData("Two\nlines", null, null)]
    [InlineData(null, "", null)]
    [InlineData(null, null, -1L)]
    [InlineData(null, null, 10_000_000L)]
    public void Values_wds_would_choke_on_are_refused(string? newName, string? newDescription, long? displayOrder)
    {
        Assert.Throws<InvalidRequestException>(() => ImageProperties.For(new BootImageChanges("WinPE", "x64", null, newName, newDescription, displayOrder)));
    }

    [Fact]
    public void A_boot_image_needs_its_architecture()
    {
        Assert.Throws<InvalidRequestException>(() => ImageProperties.For(new BootImageChanges("WinPE", " ", null, NewName: "WinPE 2")));
    }

    [Fact]
    public void An_install_image_can_get_an_unattend_file()
    {
        var parameters = ImageProperties.For(new InstallImageChanges("Windows 11 Pro", "Win11", "install.wim", UnattendXml: Unattend));

        Assert.Equal(Unattend, parameters["UnattendXml"]);
        Assert.Equal("Win11", parameters["ImageGroup"]);
        Assert.False(parameters.ContainsKey("RemoveUnattend"));
    }

    [Fact]
    public void An_install_image_can_lose_its_unattend_file()
    {
        var parameters = ImageProperties.For(new InstallImageChanges("Windows 11 Pro", "Win11", null, RemoveUnattend: true));

        Assert.Equal(true, parameters["RemoveUnattend"]);
    }

    [Fact]
    public void Replacing_and_removing_the_unattend_file_at_once_is_refused()
    {
        Assert.Throws<InvalidRequestException>(() =>
            ImageProperties.For(new InstallImageChanges("Windows 11 Pro", "Win11", null, UnattendXml: Unattend, RemoveUnattend: true)));
    }

    [Theory]
    [InlineData("<unattend xmlns=\"urn:schemas-microsoft-com:unattend\">")] // not well-formed
    [InlineData("<unattend />")] // no namespace
    [InlineData("<settings xmlns=\"urn:schemas-microsoft-com:unattend\" />")] // wrong root
    [InlineData("<?xml version=\"1.0\" encoding=\"utf-16\"?><unattend xmlns=\"urn:schemas-microsoft-com:unattend\" />")]
    [InlineData("<!DOCTYPE unattend [<!ENTITY a \"aaaa\">]><unattend xmlns=\"urn:schemas-microsoft-com:unattend\">&a;</unattend>")]
    [InlineData("")]
    public void Unattend_files_must_be_windows_setup_answer_files(string xml)
    {
        Assert.Throws<InvalidRequestException>(() => ImageProperties.Unattend(xml));
    }

    [Fact]
    public void Unattend_files_are_limited_to_a_megabyte()
    {
        var huge = Unattend.Replace("<settings", $"<!-- {new string('x', ImageProperties.MaxUnattendLength)} --><settings");

        Assert.Throws<InvalidRequestException>(() => ImageProperties.Unattend(huge));
    }

    [Fact]
    public void The_audit_log_gets_the_unattend_files_size_not_its_contents()
    {
        var changes = new InstallImageChanges("Windows 11 Pro", "Win11", null, UnattendXml: "<unattend><Password>hunter2</Password></unattend>");

        var logged = JsonSerializer.Serialize(changes.ForAudit());

        Assert.DoesNotContain("hunter2", logged);
        Assert.Contains($"({changes.UnattendXml!.Length} characters)", logged);
    }
}
