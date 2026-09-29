using System.Globalization;

namespace WdsWeb.Api.Wds;

/// <param name="Date">The driver's own date, yyyy-MM-dd.</param>
/// <param name="DateAdded">When it was added to WDS, in the server's local time (yyyy-MM-ddTHH:mm:ss).</param>
public sealed record DriverPackage(
    string Id,
    string Name,
    string? Architecture,
    string? ClassName,
    string? ClassGuid,
    string? Provider,
    string? Version,
    string? Date,
    string? DateAdded,
    bool Enabled,
    bool Signed,
    string? InfPath,
    string? Locale,
    IReadOnlyList<string> Groups);

public sealed record DriverGroup(string Name, string? Id, string? Applicability, bool Enabled, int PackageCount);

public sealed record DriverCatalog(IReadOnlyList<DriverGroup> Groups, IReadOnlyList<DriverPackage> Packages);

/// <summary>
/// Reads the WDS driver store from WDSUTIL's /Get-AllDriverPackages and
/// /Get-AllDriverGroups /Show:PackageMetaData reports. The WDS PowerShell module can't be used:
/// Get-WdsDriverPackage returns only some packages, and the CIM class none at all. The reports are
/// blocks of "Label: value" lines under "Driver Group: ..." and "Driver Package Information"
/// headings. English output only.
/// </summary>
public static class WdsUtilDriverParser
{
    private static readonly CultureInfo[] DateCultures = [CultureInfo.GetCultureInfo("en-US"), CultureInfo.GetCultureInfo("en-AU"), CultureInfo.InvariantCulture];

    public static DriverCatalog Parse(string packagesReport, string groupsReport)
    {
        var groupRecords = Scan(groupsReport);
        var membership = groupRecords
            .Where(r => r.IsPackage && r.Group is not null)
            .GroupBy(r => Field(r, "Id") ?? "", StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Select(r => Field(r.Group!, "Name") ?? "").Distinct().ToList(), StringComparer.OrdinalIgnoreCase);

        var packages = Scan(packagesReport)
            .Where(r => r.IsPackage && Field(r, "Id") is not null)
            .Select(r => ToPackage(r, membership.GetValueOrDefault(Field(r, "Id")!) ?? []))
            .ToList();

        var groups = groupRecords
            .Where(r => !r.IsPackage)
            .Select(g => new DriverGroup(
                Field(g, "Name") ?? "",
                Field(g, "ID"),
                Field(g, "Applicability"),
                IsYes(Field(g, "Enabled")),
                groupRecords.Count(p => p.IsPackage && p.Group == g)))
            .ToList();

        return new DriverCatalog(groups, packages);
    }

    private static DriverPackage ToPackage(Record r, IReadOnlyList<string> groups) => new(
        Field(r, "Id")!,
        Field(r, "Name") ?? "",
        Field(r, "Architecture"),
        Field(r, "Class name"),
        Field(r, "Class GUID"),
        Field(r, "Provider name"),
        Field(r, "Version"),
        Date(Field(r, "Date"), "yyyy-MM-dd"),
        Date(Field(r, "Date added"), "yyyy-MM-ddTHH:mm:ss"),
        IsYes(Field(r, "Enabled")),
        IsYes(Field(r, "Signed")),
        Field(r, "Package INF file path"),
        Field(r, "Locale name"),
        groups);

    // Returns the whole list, not a lazy sequence: a record's fields are filled in from the lines
    // after its heading, so it isn't complete until the scan has moved past it.
    private static List<Record> Scan(string report)
    {
        var records = new List<Record>();
        Record? group = null, current = null;
        foreach (var rawLine in report.Split('\n'))
        {
            var line = rawLine.Trim();
            if (line.StartsWith("Driver Group: ", StringComparison.Ordinal))
            {
                current = group = new Record(IsPackage: false, Group: null);
                records.Add(group);
                continue;
            }
            if (line == "Driver Package Information")
            {
                current = new Record(IsPackage: true, group);
                records.Add(current);
                continue;
            }
            if (current is null) continue;

            var separator = line.IndexOf(": ", StringComparison.Ordinal);
            if (separator > 0) current.Fields.TryAdd(line[..separator], line[(separator + 2)..].Trim());
            else if (line.EndsWith(':')) current.Fields.TryAdd(line[..^1], "");
        }
        return records;
    }

    private static string? Field(Record record, string name) =>
        record.Fields.TryGetValue(name, out var value) && value.Length > 0 ? value : null;

    private static bool IsYes(string? value) => string.Equals(value, "Yes", StringComparison.OrdinalIgnoreCase);

    // WDSUTIL writes dates like "Saturday, May 9, 2026 7:04:09 PM" in the server's local time.
    private static string? Date(string? value, string format)
    {
        if (value is null) return null;
        foreach (var culture in DateCultures)
        {
            if (DateTime.TryParse(value, culture, DateTimeStyles.AllowWhiteSpaces, out var date))
                return date.ToString(format, CultureInfo.InvariantCulture);
        }
        return value;
    }

    private sealed class Record(bool IsPackage, Record? Group)
    {
        public bool IsPackage { get; } = IsPackage;
        public Record? Group { get; } = Group;
        public Dictionary<string, string> Fields { get; } = new(StringComparer.OrdinalIgnoreCase);
    }
}
