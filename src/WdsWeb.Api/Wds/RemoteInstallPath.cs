using System.Text.RegularExpressions;

namespace WdsWeb.Api.Wds;

/// <summary>
/// The paths, relative to RemoteInstall, that server settings and devices point at. WDS stores
/// whatever it's given without checking the file exists, so the shapes are checked here instead.
/// </summary>
public static partial class RemoteInstallPath
{
    /// <summary>A boot program, such as Boot\x64\wdsmgfw.efi.</summary>
    public static bool IsBootProgram(string path) => BootProgram().IsMatch(path);

    /// <summary>A boot image, such as Boot\x64\Images\boot.wim.</summary>
    public static bool IsBootImage(string path) => BootImage().IsMatch(path);

    /// <summary>An unattend file under RemoteInstall, such as WdsClientUnattend\x64.xml.</summary>
    public static bool IsUnattendFile(string path) => UnattendFile().IsMatch(path);

    [GeneratedRegex(@"^[Bb]oot\\[A-Za-z0-9]+\\[A-Za-z0-9._-]+\.(com|efi|n12)$", RegexOptions.IgnoreCase)]
    private static partial Regex BootProgram();

    [GeneratedRegex(@"^[Bb]oot\\[A-Za-z0-9]+\\Images\\[A-Za-z0-9 ._-]+\.wim$", RegexOptions.IgnoreCase)]
    private static partial Regex BootImage();

    [GeneratedRegex(@"^(?!.*\.\.)[A-Za-z0-9 _.-]+(\\[A-Za-z0-9 _.-]+)*\.xml$", RegexOptions.IgnoreCase)]
    private static partial Regex UnattendFile();
}

/// <summary>MAC addresses in the form WDSUTIL takes and WDS reports them: 00-B0-56-88-2F-DC.</summary>
public static partial class MacAddress
{
    /// <summary>The address with dashes and capitals, from any common spelling; null if it isn't one.</summary>
    public static string? Normalize(string? value)
    {
        if (value is null) return null;
        var hex = Separators().Replace(value.Trim(), "").ToUpperInvariant();
        return Hex().IsMatch(hex) ? string.Join('-', Enumerable.Range(0, 6).Select(i => hex.Substring(i * 2, 2))) : null;
    }

    [GeneratedRegex("[-:. ]")]
    private static partial Regex Separators();

    [GeneratedRegex("^[0-9A-F]{12}$")]
    private static partial Regex Hex();
}
