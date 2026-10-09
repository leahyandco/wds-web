using System.Management.Automation.Language;
using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

public class WdsScriptsTests
{
    private const string ResourcePrefix = "WdsWeb.Scripts.";

    public static TheoryData<string> EmbeddedScripts => new(
        typeof(WdsScripts).Assembly.GetManifestResourceNames()
            .Where(n => n.StartsWith(ResourcePrefix, StringComparison.Ordinal) && n.EndsWith(".ps1", StringComparison.Ordinal))
            .Select(n => n[ResourcePrefix.Length..^".ps1".Length]));

    [Theory]
    [MemberData(nameof(EmbeddedScripts))]
    public void Every_embedded_script_parses(string name)
    {
        Parser.ParseInput(WdsScripts.Get(name), out _, out var errors);

        Assert.Empty(errors);
    }

    [Theory]
    [InlineData("Init")]
    [InlineData("Get-TargetInfo")]
    [InlineData("Get-ServerConfig")]
    [InlineData("Get-BootImages")]
    [InlineData("Get-InstallImages")]
    [InlineData("Get-Devices")]
    [InlineData("Get-DriverPackages")]
    [InlineData("Get-Events")]
    [InlineData("Get-BootActivity")]
    [InlineData("Find-ImageFiles")]
    [InlineData("Get-ImageFileInfo")]
    [InlineData("Import-WdsImage")]
    [InlineData("Import-WdsDrivers")]
    [InlineData("Get-DriverGroup")]
    [InlineData("Invoke-WdsImageAction")]
    [InlineData("Invoke-WdsUtilCommands")]
    [InlineData("Set-WdsImageProperties")]
    [InlineData("Get-WdsImageUnattend")]
    [InlineData("Set-WdsHandsFree")]
    [InlineData("Restart-WdsService")]
    public void The_scripts_the_endpoints_use_are_embedded(string name)
    {
        Assert.NotEmpty(WdsScripts.Get(name));
    }

    [Fact]
    public void Unknown_scripts_fail_loudly()
    {
        Assert.Throws<InvalidOperationException>(() => WdsScripts.Get("Remove-Everything"));
    }
}
