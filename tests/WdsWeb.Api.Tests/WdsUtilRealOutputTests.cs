using WdsWeb.Api.Wds;
using WdsWeb.Api.Wds.Demo;

namespace WdsWeb.Api.Tests;

/// <summary>
/// `wdsutil /Get-Server /Show:Config` as printed by a standalone WDS server on Windows Server 2025,
/// which demo mode also shows.
/// </summary>
public class WdsUtilRealOutputTests
{
    private static readonly IReadOnlyList<WdsUtilNode> Sections = WdsUtilOutputParser.Parse(DemoResources.Text("get-server-config.txt"));

    [Fact]
    public void Keeps_only_the_two_banners_at_the_top_level()
    {
        // The header uses "©" rather than "Copyright" on this build; it mustn't become a node.
        Assert.Equal(["SETUP INFORMATION FOR SERVER", "CONFIGURATION INFORMATION FOR SERVER"], Sections.Select(s => s.Name));
    }

    [Theory]
    [InlineData("Yes", "Server State", "Standalone configuration")]
    [InlineData(@"C:\RemoteInstall", "Installation State", "RemoteInstall location")]
    [InlineData("<Unavailable in standalone configuration>", "Server Authorization", "Authorization state")]
    [InlineData("%61Username%#", "Directory Use Policy", "New computer naming policy")]
    [InlineData(@"Boot\x64\bootmgfw.efi", "Boot Program Policy", "Default boot programs", "x64uefi")]
    [InlineData("Join Only", "Pending Device Policy", "Defaults for x64uefi", "Join rights")]
    [InlineData("Range", "WDS Transport Server Policy", "IPv4 source")]
    [InlineData("239.192.0.2", "WDS Transport Server Policy", "IPv4 source", "Start address")]
    [InlineData("Yes", "WDS Transport Server Policy", "TFTP Properties", "Variable window extension enabled")]
    [InlineData("Info", "WDS Client Policy", "Logging policy", "Logging level")]
    public void Reads_values_by_path(string expected, params string[] path)
    {
        Assert.Equal(expected, Find(path)?.Value);
    }

    [Fact]
    public void Keeps_unset_architecture_entries_as_empty()
    {
        var bootImages = Find("Boot Image Policy", "Default boot images")!;

        Assert.Equal(["x86", "x64", "arm64", "arm", "x86uefi", "x64uefi"], bootImages.Children.Select(c => c.Name));
        Assert.All(bootImages.Children, c => Assert.Null(c.Value));
    }

    [Fact]
    public void Keeps_policies_with_nothing_under_them()
    {
        var banned = Find("Banned GUIDs list")!;

        Assert.Null(banned.Value);
        Assert.Empty(banned.Children);
    }

    [Fact]
    public void Keeps_repeated_blocks_in_order()
    {
        var controllers = Find("WDS Device Controllers")!;

        Assert.Equal(["WDSADDC", "WDSSDC"], controllers.Children.Where(c => c.Name == "Name").Select(c => c.Value));
    }

    private static WdsUtilNode? Find(params string[] path)
    {
        foreach (var section in Sections)
        {
            IReadOnlyList<WdsUtilNode> nodes = section.Children;
            WdsUtilNode? found = null;
            foreach (var name in path)
            {
                found = nodes.FirstOrDefault(n => n.Name == name);
                if (found is null) break;
                nodes = found.Children;
            }
            if (found is not null) return found;
        }
        return null;
    }
}
