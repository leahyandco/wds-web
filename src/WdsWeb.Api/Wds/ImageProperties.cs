using System.Xml;
using System.Xml.Linq;
using WdsWeb.Api.Auth;

namespace WdsWeb.Api.Wds;

// Changing an image's name, description and place in the list, and an install image's unattend file.
// Null leaves a property as it is. Name plus architecture (boot) or group (install) says which image;
// the file name tells apart two images that share a name.

/// <param name="DisplayOrder">Where the image comes in the boot menu: WDS lists lower numbers first.</param>
public sealed record BootImageChanges(
    string Name,
    string Architecture,
    string? FileName,
    string? NewName = null,
    string? NewDescription = null,
    long? DisplayOrder = null);

/// <param name="DisplayOrder">Where the image comes in the WDS client's image list: lower numbers first.</param>
/// <param name="UnattendXml">A new unattend file for Windows Setup when it installs this image.</param>
/// <param name="RemoveUnattend">Removes the image's unattend file, so Setup asks its questions again.</param>
public sealed record InstallImageChanges(
    string Name,
    string? ImageGroup,
    string? FileName,
    string? NewName = null,
    string? NewDescription = null,
    long? DisplayOrder = null,
    string? UnattendXml = null,
    bool RemoveUnattend = false) : IAuditRedacted
{
    // Unattend files often hold passwords, so the audit log only says how big the new one is.
    public object ForAudit() => this with { UnattendXml = UnattendXml is null ? null : $"({UnattendXml.Length} characters)" };
}

/// <summary>Checks image changes and turns them into the parameters of Set-WdsImageProperties.</summary>
public static class ImageProperties
{
    public const int MaxUnattendLength = 1024 * 1024;
    private const long MaxDisplayOrder = 9_999_999;
    private const string UnattendNamespace = "urn:schemas-microsoft-com:unattend";

    public static Dictionary<string, object?> For(BootImageChanges changes)
    {
        var parameters = Common("BootImage", changes.Name, changes.FileName, changes.NewName, changes.NewDescription, changes.DisplayOrder);
        parameters["Architecture"] = Required(changes.Architecture, "Say which architecture the boot image is for.");
        return NothingToChange(parameters);
    }

    public static Dictionary<string, object?> For(InstallImageChanges changes)
    {
        var parameters = Common("InstallImage", changes.Name, changes.FileName, changes.NewName, changes.NewDescription, changes.DisplayOrder);
        parameters["ImageGroup"] = string.IsNullOrWhiteSpace(changes.ImageGroup) ? null : changes.ImageGroup.Trim();
        if (changes.UnattendXml is not null && changes.RemoveUnattend)
            throw new InvalidRequestException("Either replace the unattend file or remove it, not both.");
        if (changes.UnattendXml is not null) parameters["UnattendXml"] = Unattend(changes.UnattendXml);
        if (changes.RemoveUnattend) parameters["RemoveUnattend"] = true;
        return NothingToChange(parameters);
    }

    /// <summary>
    /// The unattend file as it will be saved: well-formed XML whose root is Windows Setup's unattend
    /// element, so a typo can't leave Setup without its answers.
    /// </summary>
    public static string Unattend(string xml)
    {
        if (xml.Length > MaxUnattendLength) throw new InvalidRequestException("The unattend file can be up to 1 MB.");
        XDocument document;
        try
        {
            // Unattend files have no DTD, and refusing one rules out entity expansion tricks.
            using var reader = XmlReader.Create(new StringReader(xml), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit });
            document = XDocument.Load(reader, LoadOptions.PreserveWhitespace);
        }
        catch (XmlException ex)
        {
            throw new InvalidRequestException($"The unattend file isn't valid XML: {ex.Message}");
        }
        if (document.Root is not { } root || root.Name != XName.Get("unattend", UnattendNamespace))
            throw new InvalidRequestException($"The unattend file's root element must be <unattend xmlns=\"{UnattendNamespace}\">.");
        // It's saved as UTF-8, so a declaration claiming anything else would mislead Setup.
        if (document.Declaration?.Encoding is { Length: > 0 } encoding && !encoding.Equals("utf-8", StringComparison.OrdinalIgnoreCase))
            throw new InvalidRequestException($"The unattend file says it's {encoding}; save it as UTF-8.");
        return xml;
    }

    private static Dictionary<string, object?> Common(string target, string name, string? fileName, string? newName, string? newDescription, long? displayOrder)
    {
        var parameters = new Dictionary<string, object?>
        {
            ["Target"] = target,
            ["Name"] = Required(name, "Say which image to change."),
            ["FileName"] = string.IsNullOrWhiteSpace(fileName) ? null : fileName.Trim(),
        };
        if (newName is not null) parameters["NewName"] = Text(newName, 128, "The name");
        if (newDescription is not null) parameters["NewDescription"] = Text(newDescription, 512, "The description");
        if (displayOrder is not null)
        {
            if (displayOrder is < 0 or > MaxDisplayOrder)
                throw new InvalidRequestException($"The display order must be between 0 and {MaxDisplayOrder:N0}.");
            parameters["DisplayOrder"] = displayOrder.Value;
        }
        return parameters;
    }

    private static Dictionary<string, object?> NothingToChange(Dictionary<string, object?> parameters) =>
        parameters.ContainsKey("NewName") || parameters.ContainsKey("NewDescription") || parameters.ContainsKey("DisplayOrder")
            || parameters.ContainsKey("UnattendXml") || parameters.ContainsKey("RemoveUnattend")
            ? parameters
            : throw new InvalidRequestException("There's nothing to change.");

    private static string Required(string? value, string message) =>
        string.IsNullOrWhiteSpace(value) ? throw new InvalidRequestException(message) : value.Trim();

    private static string Text(string value, int maxLength, string what)
    {
        var text = value.Trim();
        if (text.Length == 0) throw new InvalidRequestException($"{what} can't be empty.");
        if (text.Length > maxLength) throw new InvalidRequestException($"{what} can be up to {maxLength} characters.");
        if (text.Any(char.IsControl)) throw new InvalidRequestException($"{what} can't contain line breaks or tabs.");
        return text;
    }
}
