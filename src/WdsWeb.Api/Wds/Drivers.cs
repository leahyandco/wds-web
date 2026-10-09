using System.Text.RegularExpressions;

namespace WdsWeb.Api.Wds;

// Driver groups and packages. As with devices, each change is validated and turned into fixed WDSUTIL
// arguments here; nothing from a request reaches WDSUTIL unchecked.

/// <summary>Which clients get a driver group's packages.</summary>
/// <param name="Type">As WDSUTIL takes it: one of <see cref="DriverFilters.Types"/>.</param>
/// <param name="Policy">Include: only clients that match get the group. Exclude: clients that match don't.</param>
/// <param name="Values">As WDSUTIL takes them; chassis types by name, such as MiniTower.</param>
public sealed record DriverGroupFilter(string Type, string Policy, IReadOnlyList<string> Values);

/// <param name="Applicability">Matched: each client gets the group's packages that match its hardware. All: every package.</param>
public sealed record NewDriverGroup(string Name, bool Enabled = true, string Applicability = "Matched", IReadOnlyList<DriverGroupFilter>? Filters = null);

/// <summary>Changes to a driver group. Null leaves a value as it is.</summary>
/// <param name="Filters">The group's whole set of filters, replacing the ones it has; empty removes them all.</param>
public sealed record DriverGroupChanges(string? Name = null, bool? Enabled = null, string? Applicability = null, IReadOnlyList<DriverGroupFilter>? Filters = null);

/// <summary>Changes to a driver package. Null leaves a value as it is.</summary>
public sealed record DriverPackageChanges(string? Name = null, bool? Enabled = null);

public enum DriverPackageAction { Enable, Disable, Remove, AddToGroup, RemoveFromGroup }

/// <summary>One action on many packages, such as adding a selection to a group.</summary>
/// <param name="Group">The driver group, for adding to or removing from one.</param>
public sealed record DriverPackageBatch(IReadOnlyList<string> Ids, DriverPackageAction Action, string? Group = null);

/// <summary>What WDSUTIL's driver group filters take, and how its reports' wording maps back to that.</summary>
public static class DriverFilters
{
    /// <summary>The filter types, as WDSUTIL takes them. Its reports spell them out, as in "Chassis Type".</summary>
    public static readonly string[] Types =
    [
        "Manufacturer", "Model", "ChassisType", "BiosVendor", "BiosVersion", "UUID", "OsVersion", "OsEdition", "OsLanguage", "ImageID", "DeviceGroup",
    ];

    /// <summary>The chassis types, as WDSUTIL takes them. Its reports spell them out, as in "Mini Tower" and "All-in-One".</summary>
    public static readonly string[] ChassisTypes =
    [
        "Other", "UnknownChassis", "Desktop", "LowProfileDesktop", "PizzaBox", "MiniTower", "Tower", "Portable", "Laptop", "Notebook",
        "Handheld", "DockingStation", "AllInOne", "SubNotebook", "SpaceSaving", "LunchBox", "MainSystemChassis", "ExpansionChassis",
        "SubChassis", "BusExpansionChassis", "PeripheralChassis", "StorageChassis", "RackMountChassis", "SealedCaseComputer",
        "MultiSystemChassis", "CompactPci", "AdvancedTca",
    ];

    /// <summary>The name WDSUTIL takes for one it reports or someone typed, whatever the spacing, dashes or case.</summary>
    public static string? Find(string value, IEnumerable<string> names) => names.FirstOrDefault(name => Key(name) == Key(value));

    /// <summary>A filter as a report shows it, in the terms WDSUTIL takes; anything unrecognised is kept as reported.</summary>
    public static DriverGroupFilter FromReport(string type, string? policy, IEnumerable<string> values)
    {
        var canonical = Find(type, Types) ?? type;
        return new DriverGroupFilter(
            canonical,
            policy is { Length: > 0 } ? policy : "Include",
            values.Select(v => canonical == "ChassisType" ? Find(v, ChassisTypes) ?? v : v).ToList());
    }

    private static string Key(string value) => new string(value.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
}

/// <summary>Builds the WDSUTIL commands that manage driver groups and packages.</summary>
public static partial class WdsDriverCommands
{
    /// <summary>The most packages one batch acts on; each is a WDSUTIL run of a second or so.</summary>
    public const int MaxBatch = 500;

    private static readonly string[] Architectures = ["x86", "x64", "arm", "arm64"];

    public static string[] AddGroup(NewDriverGroup group)
    {
        List<string> command =
        [
            "/Add-DriverGroup", $"/DriverGroup:{GroupName(group.Name)}", $"/Enabled:{YesNo(group.Enabled)}", $"/Applicability:{Applicability(group.Applicability)}",
        ];
        command.AddRange(FilterArguments(Filters(group.Filters ?? [])));
        return [.. command];
    }

    /// <summary>
    /// Filters first, while the group still has its old name. WDSUTIL can only remove a filter type a group
    /// has, and refuses the whole command otherwise, so the group's current filters are needed.
    /// </summary>
    public static string[][] ChangeGroup(string name, DriverGroupChanges changes, IReadOnlyList<DriverGroupFilter> currentFilters)
    {
        var group = GroupName(name);
        List<string[]> commands = [];
        if (changes.Filters is not null)
        {
            var wanted = Filters(changes.Filters);
            if (!Same(currentFilters, wanted))
            {
                if (currentFilters.Count > 0)
                    commands.Add(["/Remove-DriverGroupFilter", $"/DriverGroup:{group}", .. currentFilters.Select(f => $"/FilterType:{f.Type}")]);
                if (wanted.Count > 0)
                    commands.Add(["/Add-DriverGroupFilter", $"/DriverGroup:{group}", .. FilterArguments(wanted)]);
            }
        }

        List<string> set = ["/Set-DriverGroup", $"/DriverGroup:{group}"];
        if (changes.Enabled is { } enabled) set.Add($"/Enabled:{YesNo(enabled)}");
        if (changes.Applicability is { } applicability) set.Add($"/Applicability:{Applicability(applicability)}");
        if (changes.Name is { } newName && GroupName(newName) is var renamed && renamed != group) set.Add($"/Name:{renamed}");
        if (set.Count > 2) commands.Add([.. set]);

        return commands.Count > 0 ? [.. commands] : throw new InvalidRequestException("There's nothing to change.");
    }

    /// <remarks>The group's packages stay in the driver store.</remarks>
    public static string[] RemoveGroup(string name) => ["/Remove-DriverGroup", $"/DriverGroup:{GroupName(name)}"];

    public static string[] ChangePackage(string id, DriverPackageChanges changes)
    {
        List<string> command = ["/Set-DriverPackage", $"/PackageId:{PackageId(id)}"];
        if (changes.Name is { } name) command.Add($"/Name:{Text(name, "package name")}");
        if (changes.Enabled is { } enabled) command.Add($"/Enabled:{YesNo(enabled)}");
        return command.Count > 2 ? [.. command] : throw new InvalidRequestException("There's nothing to change.");
    }

    public static string[] RemovePackage(string id) => ["/Remove-DriverPackage", $"/PackageId:{PackageId(id)}"];

    public static string[][] Batch(DriverPackageBatch batch)
    {
        var ids = (batch.Ids ?? []).Select(PackageId).Distinct().ToList();
        if (ids.Count == 0) throw new InvalidRequestException("Choose the driver packages to change.");
        if (ids.Count > MaxBatch) throw new InvalidRequestException($"Change up to {MaxBatch} driver packages at a time.");

        return batch.Action switch
        {
            DriverPackageAction.Enable => [.. ids.Select(id => new[] { "/Set-DriverPackage", $"/PackageId:{id}", "/Enabled:Yes" })],
            DriverPackageAction.Disable => [.. ids.Select(id => new[] { "/Set-DriverPackage", $"/PackageId:{id}", "/Enabled:No" })],
            DriverPackageAction.Remove => [.. ids.Select(id => new[] { "/Remove-DriverPackage", $"/PackageId:{id}" })],
            DriverPackageAction.AddToGroup => InGroup("/Add-DriverGroupPackage", ids, batch.Group),
            DriverPackageAction.RemoveFromGroup => InGroup("/Remove-DriverGroupPackage", ids, batch.Group),
            _ => throw new InvalidRequestException("That isn't something that can be done to driver packages."),
        };

        static string[][] InGroup(string verb, List<string> ids, string? group)
        {
            var name = GroupName(group);
            return [.. ids.Select(id => new[] { verb, $"/DriverGroup:{name}", $"/PackageId:{id}" })];
        }
    }

    /// <summary>A package ID as WDS writes it: a GUID in braces, in capitals.</summary>
    public static string PackageId(string? value) =>
        Guid.TryParse(value?.Trim(), out var id)
            ? id.ToString("B").ToUpperInvariant()
            : throw new InvalidRequestException($"\"{value}\" isn't a driver package ID, which is a GUID such as {{4D36E972-E325-11CE-BFC1-08002BE10318}}.");

    public static string GroupName(string? value)
    {
        var name = value?.Trim() ?? "";
        return GroupNamePattern().IsMatch(name)
            ? name
            : throw new InvalidRequestException(
                $"\"{value}\" isn't a valid driver group name: use up to 64 letters, digits, spaces and . , _ - ( ) & + ', starting with a letter or digit.");
    }

    /// <summary>x86, x64, arm or arm64, as WDSUTIL takes it, or null for any.</summary>
    public static string? Architecture(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return Architectures.FirstOrDefault(a => string.Equals(a, value.Trim(), StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidRequestException($"\"{value}\" isn't an architecture: use {string.Join(", ", Architectures)}, or none for all.");
    }

    private static List<DriverGroupFilter> Filters(IReadOnlyList<DriverGroupFilter> filters)
    {
        var checkedFilters = filters.Select(Filter).ToList();
        if (checkedFilters.GroupBy(f => f.Type).FirstOrDefault(g => g.Count() > 1) is { } repeated)
            throw new InvalidRequestException($"Give each kind of filter once; {repeated.Key} is there twice.");
        return checkedFilters;
    }

    private static DriverGroupFilter Filter(DriverGroupFilter filter)
    {
        var type = DriverFilters.Find(filter.Type ?? "", DriverFilters.Types)
            ?? throw new InvalidRequestException($"\"{filter.Type}\" isn't a kind of driver group filter: use {string.Join(", ", DriverFilters.Types)}.");
        var policy = filter.Policy?.Trim() switch
        {
            var p when string.Equals(p, "Include", StringComparison.OrdinalIgnoreCase) => "Include",
            var p when string.Equals(p, "Exclude", StringComparison.OrdinalIgnoreCase) => "Exclude",
            _ => throw new InvalidRequestException($"A {type} filter has to include or exclude the clients that match."),
        };
        var values = (filter.Values ?? []).Select(v => v?.Trim() ?? "").Where(v => v.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (values.Count == 0) throw new InvalidRequestException($"Give the {type} filter at least one value.");
        if (values.Count > 50) throw new InvalidRequestException($"Give the {type} filter up to 50 values.");
        values = type == "ChassisType"
            ? values.Select(v => DriverFilters.Find(v, DriverFilters.ChassisTypes)
                ?? throw new InvalidRequestException($"\"{v}\" isn't a chassis type: use {string.Join(", ", DriverFilters.ChassisTypes)}.")).ToList()
            : values.Select(v => Text(v, $"{type} value")).ToList();
        return new DriverGroupFilter(type, policy, values);
    }

    private static IEnumerable<string> FilterArguments(IEnumerable<DriverGroupFilter> filters) =>
        filters.SelectMany(f => new[] { $"/FilterType:{f.Type}", $"/Policy:{f.Policy}" }.Concat(f.Values.Select(v => $"/Value:{v}")));

    private static bool Same(IReadOnlyList<DriverGroupFilter> current, List<DriverGroupFilter> wanted) =>
        current.Count == wanted.Count && wanted.All(w => current.Any(c =>
            c.Type == w.Type && c.Policy == w.Policy &&
            c.Values.Count == w.Values.Count && c.Values.All(v => w.Values.Contains(v, StringComparer.OrdinalIgnoreCase))));

    private static string Applicability(string? value) => value?.Trim() switch
    {
        var v when string.Equals(v, "Matched", StringComparison.OrdinalIgnoreCase) => "Matched",
        var v when string.Equals(v, "All", StringComparison.OrdinalIgnoreCase) => "All",
        _ => throw new InvalidRequestException("A driver group gives clients either the packages that match their hardware (Matched) or all of them (All)."),
    };

    /// <summary>
    /// Free text for WDSUTIL. Windows PowerShell 5.1 quotes an argument with spaces without escaping quotes
    /// inside it, or a backslash at its end, so neither can be allowed through.
    /// </summary>
    private static string Text(string value, string what)
    {
        var text = value.Trim();
        return text.Length is > 0 and <= 128 && !text.Contains('"') && !text.EndsWith('\\') && !text.Any(char.IsControl)
            ? text
            : throw new InvalidRequestException($"\"{value}\" isn't a valid {what}: use up to 128 characters, without double quotes or a backslash at the end.");
    }

    private static string YesNo(bool value) => value ? "Yes" : "No";

    [GeneratedRegex(@"^[A-Za-z0-9](?:[A-Za-z0-9 .,_()&+'-]{0,62}[A-Za-z0-9.,_()&+'-])?$")]
    private static partial Regex GroupNamePattern();
}
