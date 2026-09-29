using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

public class WdsUtilOutputParserTests
{
    // Shaped like `wdsutil /Get-Server /Show:Config`, trimmed.
    private const string Sample = """
        Windows Deployment Services Management Utility [Version 10.0.26100.1]
        Copyright (C) Microsoft Corporation. All rights reserved.


        SETUP INFORMATION FOR SERVER
        [-----------------------------------------------------------------------------]

        Server State:
             OS version: 10.0
             WDS operational mode: Native
             Standalone configuration: Yes

        Installation State:
             RemoteInstall location: C:\RemoteInstall
             RemoteInstall share up-to-date: Yes
             Boot files installed:
                  x86     - Yes
                  x64     - Yes
                  arm64   -

        [-----------------------------------------------------------------------------]

        CONFIGURATION INFORMATION FOR SERVER
        [-----------------------------------------------------------------------------]

        Answer Policy:
             Answer clients: Yes
             Response delay: 0 seconds

        Boot Program Policy:
             Default boot programs:
                  x64uefi - boot\x64\wdsmgfw.efi

        [-----------------------------------------------------------------------------]


        The command completed successfully.
        """;

    [Fact]
    public void Groups_everything_under_the_upper_case_banners()
    {
        var sections = WdsUtilOutputParser.Parse(Sample);

        Assert.Equal(["SETUP INFORMATION FOR SERVER", "CONFIGURATION INFORMATION FOR SERVER"], sections.Select(s => s.Name));
        Assert.Equal(["Server State", "Installation State"], sections[0].Children.Select(c => c.Name));
        Assert.Equal(["Answer Policy", "Boot Program Policy"], sections[1].Children.Select(c => c.Name));
    }

    [Fact]
    public void Splits_labels_from_values_at_the_first_colon_space()
    {
        var install = WdsUtilOutputParser.Parse(Sample)[0].Children[1];

        var location = Assert.Single(install.Children, c => c.Name == "RemoteInstall location");
        Assert.Equal(@"C:\RemoteInstall", location.Value);
        Assert.Equal("Standalone configuration", WdsUtilOutputParser.Parse(Sample)[0].Children[0].Children[2].Name);
    }

    [Fact]
    public void Nests_per_architecture_lists_and_keeps_empty_entries()
    {
        var bootFiles = WdsUtilOutputParser.Parse(Sample)[0].Children[1].Children
            .Single(c => c.Name == "Boot files installed");

        Assert.Null(bootFiles.Value);
        Assert.Equal(
            [("x86", "Yes"), ("x64", "Yes"), ("arm64", null)],
            bootFiles.Children.Select(c => (c.Name, c.Value)));
    }

    [Fact]
    public void Keeps_paths_in_list_values()
    {
        var bootPrograms = WdsUtilOutputParser.Parse(Sample)[1].Children[1].Children.Single();

        var uefi = Assert.Single(bootPrograms.Children);
        Assert.Equal(("x64uefi", @"boot\x64\wdsmgfw.efi"), (uefi.Name, uefi.Value));
    }

    [Fact]
    public void Drops_the_header_separators_and_completion_message()
    {
        var names = Flatten(WdsUtilOutputParser.Parse(Sample)).Select(n => n.Name).ToList();

        Assert.DoesNotContain(names, n => n.StartsWith("Windows Deployment Services", StringComparison.Ordinal));
        Assert.DoesNotContain(names, n => n.StartsWith("Copyright", StringComparison.Ordinal));
        Assert.DoesNotContain(names, n => n.Contains("---", StringComparison.Ordinal));
        Assert.DoesNotContain(names, n => n.StartsWith("The command completed", StringComparison.Ordinal));
    }

    private static IEnumerable<WdsUtilNode> Flatten(IEnumerable<WdsUtilNode> nodes) =>
        nodes.SelectMany(n => Flatten(n.Children).Prepend(n));
}
