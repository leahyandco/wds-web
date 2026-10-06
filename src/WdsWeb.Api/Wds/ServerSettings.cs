using System.Globalization;
using System.Net;
using System.Net.Sockets;

namespace WdsWeb.Api.Wds;

// The server settings the console can change, one record per form. Each is validated and turned into
// fixed WDSUTIL arguments by WdsSettingsCommands; nothing from a request reaches WDSUTIL unchecked.

public sealed record PxeSettings(string AnswerClients, int ResponseDelay, string KnownClientPrompt, string NewClientPrompt);

/// <param name="BootProgram">Relative to RemoteInstall, e.g. Boot\x64\wdsmgfw.efi. Null leaves it unchanged.</param>
/// <param name="BootImage">Relative to RemoteInstall, e.g. Boot\x64\Images\boot.wim; "" clears it. Null leaves it unchanged.</param>
public sealed record ArchitectureBootDefaults(string Architecture, string? BootProgram, string? BootImage);

/// <param name="X64ImageType">Which boot images x64 clients see: x86, x64 or Both. Null leaves it unchanged.</param>
public sealed record BootDefaultsSettings(IReadOnlyList<ArchitectureBootDefaults> Architectures, string? X64ImageType);

/// <param name="File">Relative to RemoteInstall, e.g. WdsClientUnattend\x64.xml; "" clears it.</param>
public sealed record ClientUnattendFile(string Architecture, string File);

public sealed record ClientSettings(
    bool LoggingEnabled,
    string LoggingLevel,
    bool UnattendEnabled,
    bool CommandLinePrecedence,
    IReadOnlyList<ClientUnattendFile>? UnattendFiles);

public sealed record PendingDeviceSettings(
    string Policy,
    int PollInterval,
    int MaxRetry,
    string? Message,
    int ApprovedRetentionDays,
    int OtherRetentionDays);

/// <param name="Type">IP or MAC.</param>
public sealed record BindAddress(string Address, string Type);

/// <param name="Policy">Include (listen only on the registered interfaces) or Exclude (listen on all but them).</param>
public sealed record BindSettings(string Policy, IReadOnlyList<BindAddress>? Add, IReadOnlyList<BindAddress>? Remove);

public sealed record TransportSettings(
    int TftpMaximumBlockSize,
    bool TftpVariableWindowExtension,
    string MulticastPolicy,
    int AutoDisconnectThreshold,
    int StreamCount,
    bool Fallback);

/// <summary>Builds the WDSUTIL commands for a settings change, rejecting anything out of range.</summary>
public static class WdsSettingsCommands
{
    public static readonly string[] Architectures = ["x86", "x64", "arm", "arm64", "x86uefi", "x64uefi"];
    private static readonly string[] Prompts = ["OptIn", "OptOut", "NoPrompt", "Abort"];

    public static IReadOnlyList<string[]> For(PxeSettings s) =>
    [
        ["/Set-Server", $"/AnswerClients:{OneOf(s.AnswerClients, "which clients to answer", "All", "Known", "None")}"],
        ["/Set-Server", $"/ResponseDelay:{InRange(s.ResponseDelay, 0, 300, "The response delay")}"],
        ["/Set-Server", "/PxePromptPolicy",
            $"/Known:{OneOf(s.KnownClientPrompt, "the prompt for known clients", Prompts)}",
            $"/New:{OneOf(s.NewClientPrompt, "the prompt for new clients", Prompts)}"],
    ];

    public static IReadOnlyList<string[]> For(BootDefaultsSettings s)
    {
        var commands = new List<string[]>();
        foreach (var entry in s.Architectures)
        {
            var architecture = Architecture(entry.Architecture);
            if (entry.BootProgram is not null)
            {
                if (!RemoteInstallPath.IsBootProgram(entry.BootProgram))
                    throw new InvalidRequestException($"{entry.BootProgram} isn't a boot program under RemoteInstall\\Boot (.com, .efi or .n12).");
                commands.Add(["/Set-Server", $"/BootProgram:{entry.BootProgram}", $"/Architecture:{architecture}"]);
            }
            if (entry.BootImage is not null)
            {
                if (entry.BootImage.Length > 0 && !RemoteInstallPath.IsBootImage(entry.BootImage))
                    throw new InvalidRequestException($"{entry.BootImage} isn't a boot image under RemoteInstall\\Boot\\<architecture>\\Images.");
                commands.Add(["/Set-Server", $"/BootImage:{entry.BootImage}", $"/Architecture:{architecture}"]);
            }
        }
        if (s.X64ImageType is not null)
            commands.Add(["/Set-Server", $"/DefaultX86X64ImageType:{OneOf(s.X64ImageType, "the image type for x64 clients", "x86", "x64", "Both")}"]);
        return commands;
    }

    public static IReadOnlyList<string[]> For(ClientSettings s)
    {
        List<string[]> commands =
        [
            ["/Set-Server", "/WdsClientLogging", $"/Enabled:{YesNo(s.LoggingEnabled)}",
                $"/LoggingLevel:{OneOf(s.LoggingLevel, "the logging level", "None", "Errors", "Warnings", "Info")}"],
            ["/Set-Server", "/WdsUnattend", $"/Policy:{(s.UnattendEnabled ? "Enabled" : "Disabled")}",
                $"/CommandlinePrecedence:{YesNo(s.CommandLinePrecedence)}"],
        ];
        foreach (var file in s.UnattendFiles ?? [])
        {
            if (file.File.Length > 0 && !RemoteInstallPath.IsUnattendFile(file.File))
                throw new InvalidRequestException($"{file.File} isn't an .xml file under RemoteInstall.");
            commands.Add(["/Set-Server", "/WdsUnattend", $"/File:{file.File}", $"/Architecture:{Architecture(file.Architecture)}"]);
        }
        return commands;
    }

    public static IReadOnlyList<string[]> For(PendingDeviceSettings s)
    {
        var command = new List<string>
        {
            "/Set-Server", "/PendingDevicePolicy",
            $"/Policy:{OneOf(s.Policy, "the pending-device policy", "AdminApproval", "Disabled")}",
            $"/PollInterval:{InRange(s.PollInterval, 1, 3600, "The poll interval")}",
            $"/MaxRetry:{InRange(s.MaxRetry, 1, 100_000, "The retry count")}",
        };
        if (s.Message is not null)
        {
            if (s.Message.Length > 256 || s.Message.Any(c => char.IsControl(c) || c == '"'))
                throw new InvalidRequestException("The message can be up to 256 characters, without quotes or line breaks.");
            command.Add($"/Message:{s.Message}");
        }
        command.AddRange([
            "/RetentionPeriod",
            $"/Approved:{InRange(s.ApprovedRetentionDays, 1, 3650, "The retention for approved devices")}",
            $"/Others:{InRange(s.OtherRetentionDays, 1, 3650, "The retention for other devices")}",
        ]);
        return [command.ToArray()];
    }

    public static IReadOnlyList<string[]> For(BindSettings s)
    {
        List<string[]> commands = [["/Set-Server", "/BindPolicy", $"/Policy:{OneOf(s.Policy, "the bind policy", "Include", "Exclude")}"]];
        foreach (var address in s.Remove ?? [])
            commands.Add(["/Set-Server", "/BindPolicy", "/Remove", .. BindTarget(address)]);
        foreach (var address in s.Add ?? [])
            commands.Add(["/Set-Server", "/BindPolicy", "/Add", .. BindTarget(address)]);
        return commands;
    }

    public static IReadOnlyList<string[]> For(TransportSettings s)
    {
        if (s.TftpMaximumBlockSize is not 0 and (< 512 or > 16384))
            throw new InvalidRequestException("The TFTP block size must be 0 (automatic) or between 512 and 16384.");
        return
        [
            ["/Set-TransportServer", $"/TftpMaximumBlockSize:{s.TftpMaximumBlockSize}", $"/EnableTftpVariableWindowExtension:{YesNo(s.TftpVariableWindowExtension)}"],
            ["/Set-TransportServer", "/MulticastSessionPolicy",
                $"/Policy:{OneOf(s.MulticastPolicy, "the slow-client policy", "None", "AutoDisconnect", "Multistream")}",
                $"/Threshold:{InRange(s.AutoDisconnectThreshold, 1, 1_048_576, "The disconnect threshold")}",
                $"/StreamCount:{InRange(s.StreamCount, 2, 3, "The stream count")}",
                $"/Fallback:{YesNo(s.Fallback)}"],
        ];
    }

    private static string[] BindTarget(BindAddress address)
    {
        var type = OneOf(address.Type, "the address type", "IP", "MAC");
        var value = address.Address.Trim();
        if (type == "IP")
        {
            if (!IPAddress.TryParse(value, out var ip) || ip.AddressFamily != AddressFamily.InterNetwork)
                throw new InvalidRequestException($"{value} isn't an IPv4 address.");
            value = ip.ToString();
        }
        else
        {
            value = MacAddress.Normalize(value) ?? throw new InvalidRequestException($"{value} isn't a MAC address.");
        }
        return [$"/Address:{value}", $"/AddressType:{type}"];
    }

    private static string Architecture(string value) => OneOf(value, "the architecture", Architectures);

    /// <summary>The allowed value that matches, ignoring case, spelled the way WDSUTIL documents it.</summary>
    private static string OneOf(string? value, string what, params string[] allowed) =>
        allowed.FirstOrDefault(a => string.Equals(a, value?.Trim(), StringComparison.OrdinalIgnoreCase))
        ?? throw new InvalidRequestException($"\"{value}\" isn't a valid choice for {what}: use {string.Join(", ", allowed)}.");

    private static string InRange(int value, int min, int max, string what) =>
        value >= min && value <= max
            ? value.ToString(CultureInfo.InvariantCulture)
            : throw new InvalidRequestException($"{what} must be between {min} and {max}.");

    private static string YesNo(bool value) => value ? "Yes" : "No";
}
