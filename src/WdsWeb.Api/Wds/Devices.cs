using System.Globalization;
using System.Text.RegularExpressions;

namespace WdsWeb.Api.Wds;

// Prestaged devices and pending-device requests. As with server settings, each change is validated and
// turned into fixed WDSUTIL arguments by WdsDeviceCommands; nothing from a request reaches WDSUTIL unchecked.

/// <param name="Name">The device's name in WDS: letters, digits, hyphens and underscores, as in a host name.</param>
/// <param name="DeviceId">The MAC address, or the SMBIOS GUID, that the client reports when it PXE boots.</param>
/// <param name="PxePromptPolicy">OptIn, OptOut, NoPrompt or Abort. Null or "" follows the server's policy for known clients.</param>
/// <param name="BootImagePath">Relative to RemoteInstall, e.g. Boot\x64\Images\boot.wim. Null or "" lets the client choose.</param>
/// <param name="WdsClientUnattend">Relative to RemoteInstall, e.g. WdsClientUnattend\x64.xml. Null or "" uses the server's.</param>
/// <param name="JoinDomain">
/// Whether the WDS client joins the computer to the domain under this name. Null leaves WDS's default, yes,
/// which on a standalone server only ends the install with a failed join (event 4113).
/// </param>
public sealed record NewDevice(
    string Name,
    string DeviceId,
    string? Group = null,
    string? PxePromptPolicy = null,
    string? BootImagePath = null,
    string? WdsClientUnattend = null,
    bool? JoinDomain = null);

/// <summary>Changes to a prestaged device. Null leaves a value as it is; "" clears it.</summary>
/// <param name="PxePromptPolicy">"" goes back to the server's policy for known clients.</param>
public sealed record DeviceChanges(
    string? DeviceId = null,
    string? Group = null,
    string? PxePromptPolicy = null,
    string? BootImagePath = null,
    string? WdsClientUnattend = null,
    bool? JoinDomain = null);

/// <summary>
/// Which answered requests to delete. WDS keeps them for the retention period, and while the pending-device
/// policy is on it acts on them: a rejected device is turned away, and a device approved and since removed
/// gets no answer at all.
/// </summary>
public sealed record ClearedRequests(bool Approved, bool Rejected);

/// <summary>What to give a device when approving its request. Anything left out follows the server's settings.</summary>
public sealed record DeviceApproval(string? Name = null, string? BootImagePath = null, string? WdsClientUnattend = null, bool? JoinDomain = null);

/// <summary>Builds the WDSUTIL commands that prestage, change and remove devices, and answer requests.</summary>
public static partial class WdsDeviceCommands
{
    private static readonly string[] Prompts = ["OptIn", "OptOut", "NoPrompt", "Abort"];

    public static string[] Add(NewDevice device)
    {
        List<string> command = ["/Add-Device", $"/Device:{Name(device.Name)}", $"/ID:{DeviceId(device.DeviceId)}"];
        if (!string.IsNullOrWhiteSpace(device.Group)) command.Add($"/Group:{Group(device.Group)}");
        if (!string.IsNullOrWhiteSpace(device.PxePromptPolicy)) command.Add($"/PxePromptPolicy:{Prompt(device.PxePromptPolicy)}");
        if (!string.IsNullOrWhiteSpace(device.BootImagePath)) command.Add($"/BootImagePath:{BootImage(device.BootImagePath)}");
        if (!string.IsNullOrWhiteSpace(device.WdsClientUnattend)) command.Add($"/WdsClientUnattend:{Unattend(device.WdsClientUnattend)}");
        if (device.JoinDomain is { } join) command.Add(JoinDomain(join));
        return [.. command];
    }

    /// <remarks>WDSUTIL clears a value given as nothing, e.g. /BootImagePath: with no path.</remarks>
    public static string[] Change(string name, DeviceChanges changes)
    {
        List<string> command = ["/Set-Device", $"/Device:{Name(name)}"];
        if (changes.DeviceId is not null) command.Add($"/ID:{DeviceId(changes.DeviceId)}");
        if (changes.Group is not null) command.Add($"/Group:{OrClear(changes.Group, Group)}");
        if (changes.PxePromptPolicy is not null) command.Add($"/PxePromptPolicy:{OrClear(changes.PxePromptPolicy, Prompt)}");
        if (changes.BootImagePath is not null) command.Add($"/BootImagePath:{OrClear(changes.BootImagePath, BootImage)}");
        if (changes.WdsClientUnattend is not null) command.Add($"/WdsClientUnattend:{OrClear(changes.WdsClientUnattend, Unattend)}");
        if (changes.JoinDomain is { } join) command.Add(JoinDomain(join));
        if (command.Count == 2) throw new InvalidRequestException("There's nothing to change.");
        return [.. command];
    }

    public static string[] Remove(string name) => ["/Remove-Device", $"/Device:{Name(name)}"];

    /// <remarks>One request at a time: the request ID is a number, so WDSUTIL's "ALL" can't get through.</remarks>
    public static string[] Approve(uint requestId, DeviceApproval approval)
    {
        List<string> command = ["/Approve-AutoAddDevices", $"/RequestId:{RequestId(requestId)}"];
        if (!string.IsNullOrWhiteSpace(approval.Name)) command.Add($"/MachineName:{Name(approval.Name)}");
        if (!string.IsNullOrWhiteSpace(approval.BootImagePath)) command.Add($"/BootImagePath:{BootImage(approval.BootImagePath)}");
        if (!string.IsNullOrWhiteSpace(approval.WdsClientUnattend)) command.Add($"/WdsClientUnattend:{Unattend(approval.WdsClientUnattend)}");
        if (approval.JoinDomain is { } join) command.Add(JoinDomain(join));
        return [.. command];
    }

    public static string[] Reject(uint requestId) => ["/Reject-AutoAddDevices", $"/RequestId:{RequestId(requestId)}"];

    /// <remarks>WDS deletes requests only by status, never one at a time; the devices approved stay prestaged.</remarks>
    public static string[][] Clear(ClearedRequests cleared)
    {
        List<string[]> commands = [];
        if (cleared.Approved) commands.Add(["/Delete-AutoAddDevices", "/DeviceType:ApprovedDevices"]);
        if (cleared.Rejected) commands.Add(["/Delete-AutoAddDevices", "/DeviceType:RejectedDevices"]);
        return commands.Count > 0 ? [.. commands] : throw new InvalidRequestException("Say which requests to clear: approved, rejected or both.");
    }

    /// <summary>
    /// A MAC address with dashes (WDSUTIL refuses colons) or a GUID in braces and capitals: how WDS
    /// stores device IDs, and how PXE boot events report them.
    /// </summary>
    public static string DeviceId(string? value)
    {
        if (MacAddress.Normalize(value) is { } mac) return mac;
        var text = value?.Trim() ?? "";
        // Only the dashed GUID form. WDSUTIL also takes 32 bare hex digits, but in a different byte order
        // from the dashed form, so the same digits typed either way would name different machines.
        if (DashedGuid().IsMatch(text) && Guid.TryParse(text, out var guid)) return guid.ToString("B").ToUpperInvariant();
        throw new InvalidRequestException(
            $"\"{value}\" isn't a MAC address (like 00-B0-56-88-2F-DC) or a GUID (like {{E8A3EFAC-201F-4E69-953E-B2DAA1E8B1B6}}).");
    }

    /// <summary>WDS checks device names as DNS names, and refuses spaces among other things.</summary>
    public static string Name(string? value)
    {
        var name = value?.Trim() ?? "";
        return DeviceName().IsMatch(name)
            ? name
            : throw new InvalidRequestException(
                $"\"{value}\" isn't a valid device name: use up to 63 letters, digits, hyphens and underscores, not starting or ending with a hyphen.");
    }

    private static string Group(string value)
    {
        var group = value.Trim();
        return GroupName().IsMatch(group)
            ? group
            : throw new InvalidRequestException($"\"{value}\" isn't a valid group name: use up to 64 letters, digits, spaces, hyphens, underscores and periods.");
    }

    private static string Prompt(string value) =>
        Prompts.FirstOrDefault(p => string.Equals(p, value.Trim(), StringComparison.OrdinalIgnoreCase))
        ?? throw new InvalidRequestException($"\"{value}\" isn't a PXE prompt policy: use {string.Join(", ", Prompts)}.");

    private static string BootImage(string value)
    {
        var path = value.Trim();
        return RemoteInstallPath.IsBootImage(path)
            ? path
            : throw new InvalidRequestException($"{value} isn't a boot image under RemoteInstall\\Boot\\<architecture>\\Images.");
    }

    private static string Unattend(string value)
    {
        var path = value.Trim();
        return RemoteInstallPath.IsUnattendFile(path) ? path : throw new InvalidRequestException($"{value} isn't an .xml file under RemoteInstall.");
    }

    private static string JoinDomain(bool join) => join ? "/JoinDomain:Yes" : "/JoinDomain:No";

    private static string RequestId(uint id) =>
        id > 0 ? id.ToString(CultureInfo.InvariantCulture) : throw new InvalidRequestException("Say which request to answer.");

    /// <summary>An empty value clears the setting; anything else has to pass its check.</summary>
    private static string OrClear(string value, Func<string, string> check) => value.Trim().Length == 0 ? "" : check(value);

    [GeneratedRegex("^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$")]
    private static partial Regex DeviceName();

    [GeneratedRegex("^[A-Za-z0-9 _.-]{1,64}$")]
    private static partial Regex GroupName();

    [GeneratedRegex(@"^\{?[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}?$")]
    private static partial Regex DashedGuid();
}
