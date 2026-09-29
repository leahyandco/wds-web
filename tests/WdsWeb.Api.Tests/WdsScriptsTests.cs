using System.Management.Automation.Language;
using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

public class WdsScriptsTests
{
    public static TheoryData<string> ScriptNames =>
        ["Init", "Get-TargetInfo", "Get-ServerConfig", "Get-BootImages", "Get-InstallImages", "Get-Devices", "Get-Events"];

    [Theory]
    [MemberData(nameof(ScriptNames))]
    public void Every_script_is_embedded_and_parses(string name)
    {
        var script = WdsScripts.Get(name);

        Parser.ParseInput(script, out _, out var errors);
        Assert.Empty(errors);
    }

    [Fact]
    public void Unknown_scripts_fail_loudly()
    {
        Assert.Throws<InvalidOperationException>(() => WdsScripts.Get("Remove-Everything"));
    }
}
