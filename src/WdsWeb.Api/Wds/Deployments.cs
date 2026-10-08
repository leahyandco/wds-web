using System.Globalization;

namespace WdsWeb.Api.Wds;

/// <summary>How far the WDS client (Windows Setup in WDS mode) got with installing an image.</summary>
public enum DeploymentStage
{
    /// <summary>The WDS client started in WinPE.</summary>
    Started,

    /// <summary>Someone (or the unattend file) chose an install image.</summary>
    ImageSelected,

    /// <summary>Downloading the image.</summary>
    Transferring,

    /// <summary>Writing the image to the disk.</summary>
    Applying,

    /// <summary>After the image: drivers, unattend, boot files.</summary>
    Finishing,

    /// <summary>The WDS client finished; Windows Setup carries on from the disk after a restart.</summary>
    Finished,

    Failed,
}

/// <param name="Level">info, warning or error.</param>
public sealed record DeploymentNote(DateTimeOffset Time, string Level, string Text);

/// <summary>An install, as the WDS client reported it with client logging on.</summary>
public sealed record Deployment(
    DeploymentStage Stage,
    DateTimeOffset StartedAt,
    DateTimeOffset LastSeen,
    string? ClientVersion,
    string? WinPeVersion,
    string? ImageGroup,
    string? ImageName,
    string? ImageLanguage,
    string? ImageArchitecture,
    string? UserName,
    string? MulticastNamespace,
    DateTimeOffset? TransferStartedAt,
    DateTimeOffset? TransferFinishedAt,
    DateTimeOffset? ApplyStartedAt,
    DateTimeOffset? ApplyFinishedAt,
    DateTimeOffset? FinishedAt,
    string? Error,
    IReadOnlyList<DeploymentNote> Timeline);

/// <summary>
/// The WDS client's own events (4102-4131 in the Operational log, 4113 and 4114 in the Admin log),
/// which WDS logs only while client logging is on (Server settings → WDS client). Their meanings and
/// field names come from the event definitions of Microsoft-Windows-Deployment-Services-Diagnostics.
/// </summary>
public static class DeploymentEvents
{
    public const int ClientStarted = 4102;
    public const int UnattendMode = 4103;
    public const int ImageSelected = 4104;
    public const int TransferStarted = 4105;
    public const int TransferEnded = 4106;
    public const int TransferDowngraded = 4107;
    public const int ApplyStarted = 4108;
    public const int ApplyEnded = 4109;
    public const int PostApplyStarted = 4110;
    public const int PostApplyEnded = 4111;
    public const int ClientEnded = 4112;
    public const int DomainJoinError = 4113;
    public const int FatalError = 4114;
    public const int ClientMessage = 4115;
    public const int MulticastJoined = 4120;
    public const int MulticastLeft = 4121;
    public const int MulticastForcedOut = 4122;
    public const int DriverPackageInaccessible = 4123;
    public const int DriverInjectionStarted = 4124;
    public const int DriverInjectionEnded = 4125;
    public const int DriverInjectionFailed = 4126;
    public const int DriverRequestFailed = 4128;
    public const int DriverRequestCompleted = 4129;
    public const int MulticastDemoted = 4130;
    public const int ImageSelectedWithDetails = 4131;

    private static readonly HashSet<int> Ids =
    [
        ClientStarted, UnattendMode, ImageSelected, TransferStarted, TransferEnded, TransferDowngraded, ApplyStarted, ApplyEnded,
        PostApplyStarted, PostApplyEnded, ClientEnded, DomainJoinError, FatalError, ClientMessage, MulticastJoined, MulticastLeft,
        MulticastForcedOut, DriverPackageInaccessible, DriverInjectionStarted, DriverInjectionEnded, DriverInjectionFailed,
        DriverRequestFailed, DriverRequestCompleted, MulticastDemoted, ImageSelectedWithDetails,
    ];

    public static bool IsDeploymentEvent(int id) => Ids.Contains(id);
}

/// <summary>Collects one WDS client's events into a <see cref="Deployment"/>.</summary>
internal sealed class DeploymentBuilder(DateTimeOffset startedAt)
{
    private readonly List<DeploymentNote> _timeline = [];
    private DeploymentStage _stage = DeploymentStage.Started;
    private DateTimeOffset _startedAt = startedAt;
    private DateTimeOffset _lastSeen = startedAt;
    private string? _clientVersion, _winPeVersion, _imageGroup, _imageName, _imageLanguage, _imageArchitecture, _userName, _multicast, _error;
    private DateTimeOffset? _transferStarted, _transferFinished, _applyStarted, _applyFinished, _finished;

    /// <summary>Still going: a long image apply can go quiet for a while, so the session stays open.</summary>
    public bool Active => _stage is not (DeploymentStage.Finished or DeploymentStage.Failed);

    public void Apply(WdsEventRecord record)
    {
        string? Field(string name) => record.Data.GetValueOrDefault(name) is { Length: > 0 } value ? value : null;
        void Note(string level, string text) => _timeline.Add(new DeploymentNote(record.Time, level, text));
        void Advance(DeploymentStage stage)
        {
            // Events can arrive out of order within a second; never go backwards, and stay failed.
            if (_stage != DeploymentStage.Failed && stage > _stage) _stage = stage;
        }

        _lastSeen = record.Time > _lastSeen ? record.Time : _lastSeen;
        switch (record.Id)
        {
            case DeploymentEvents.ClientStarted:
                _startedAt = record.Time < _startedAt ? record.Time : _startedAt;
                _clientVersion = Field("ClientVersion") ?? _clientVersion;
                _winPeVersion = Field("WinPEVersion") ?? _winPeVersion;
                Note("info", $"The WDS client started{(_winPeVersion is null ? "" : $" in WinPE {_winPeVersion}")}");
                break;
            case DeploymentEvents.UnattendMode:
                Note("info", $"Unattend mode: {Field("UnattendMode") ?? "unknown"}");
                break;
            case DeploymentEvents.ImageSelected or DeploymentEvents.ImageSelectedWithDetails:
                _imageGroup = Field("ImageGroup") ?? _imageGroup;
                _imageName = Field("ImageName") ?? _imageName;
                _imageLanguage = Field("ImageLanguage") ?? _imageLanguage;
                _imageArchitecture = Field("ImageArch") ?? _imageArchitecture;
                _userName = Field("FullUserName") ?? _userName;
                Advance(DeploymentStage.ImageSelected);
                Note("info", $"Chose {_imageName ?? "an image"}{(_imageGroup is null ? "" : $" from {_imageGroup}")}{(_userName is null ? "" : $", signed in as {_userName}")}");
                break;
            case DeploymentEvents.TransferStarted:
                _transferStarted ??= record.Time;
                _multicast = Field("MulticastNamespace") ?? _multicast;
                Advance(DeploymentStage.Transferring);
                Note("info", _multicast is null ? "Started downloading the image" : $"Started downloading the image by multicast ({_multicast})");
                break;
            case DeploymentEvents.TransferEnded:
                _transferFinished = record.Time;
                Advance(DeploymentStage.Transferring);
                Note("info", "Finished downloading the image");
                break;
            case DeploymentEvents.TransferDowngraded:
                Note("warning", "The multicast download fell back to a slower one");
                break;
            case DeploymentEvents.ApplyStarted:
                _applyStarted ??= record.Time;
                Advance(DeploymentStage.Applying);
                Note("info", "Started applying the image to the disk");
                break;
            case DeploymentEvents.ApplyEnded:
                _applyFinished = record.Time;
                Advance(DeploymentStage.Applying);
                Note("info", "Finished applying the image");
                break;
            case DeploymentEvents.PostApplyStarted:
                Advance(DeploymentStage.Finishing);
                Note("info", "Started the steps after applying (drivers, unattend, boot files)");
                break;
            case DeploymentEvents.PostApplyEnded:
                Advance(DeploymentStage.Finishing);
                Note("info", "Finished the steps after applying");
                break;
            case DeploymentEvents.ClientEnded:
                _finished = record.Time;
                Advance(DeploymentStage.Finished);
                Note("info", _stage == DeploymentStage.Failed ? "The WDS client stopped" : "The WDS client finished; Windows Setup carries on after the restart");
                break;
            case DeploymentEvents.DomainJoinError:
                _error = $"Couldn't join {Field("MachineName") ?? "the computer"} to the domain{Code(Field("ErrorCode"))}";
                Note("error", _error);
                break;
            case DeploymentEvents.FatalError:
                _error = Field("ErrorMessage") ?? "The WDS client hit a fatal error";
                _stage = DeploymentStage.Failed;
                Note("error", _error);
                break;
            case DeploymentEvents.ClientMessage:
                Note("info", Field("Message") ?? "(an empty message)");
                break;
            case DeploymentEvents.MulticastJoined:
                Note("info", $"Joined the multicast transmission {Field("ObjectName") ?? Field("NamespaceName")}");
                break;
            case DeploymentEvents.MulticastLeft:
                Note("info", "Left the multicast transmission");
                break;
            case DeploymentEvents.MulticastForcedOut:
                Note("warning", $"Dropped from the multicast transmission{(Field("Reason") is { } reason ? $": {reason}" : "")}");
                break;
            case DeploymentEvents.MulticastDemoted:
                Note("warning", "Moved to a slower multicast transmission");
                break;
            case DeploymentEvents.DriverPackageInaccessible:
                Note("warning", $"Couldn't reach the driver package {Field("DriverPackageName")}{Code(Field("ErrorCode"))}");
                break;
            case DeploymentEvents.DriverInjectionStarted:
                Note("info", "Started adding driver packages");
                break;
            case DeploymentEvents.DriverInjectionEnded:
                Note("info", "Finished adding driver packages");
                break;
            case DeploymentEvents.DriverInjectionFailed:
                Note("warning", $"Couldn't add the driver package {Field("DriverPackageName")}{Code(Field("ErrorCode"))}");
                break;
            case DeploymentEvents.DriverRequestCompleted:
                Note("info", $"WDS offered {Field("NumDriverPackages") ?? "some"} matching driver packages");
                break;
            case DeploymentEvents.DriverRequestFailed:
                Note("warning", $"Asking WDS for matching drivers failed{Code(Field("ErrorCode"))}");
                break;
        }
    }

    public Deployment Build() => new(
        _stage, _startedAt, _lastSeen, _clientVersion, _winPeVersion, _imageGroup, _imageName, _imageLanguage, _imageArchitecture,
        _userName, _multicast, _transferStarted, _transferFinished, _applyStarted, _applyFinished, _finished, _error,
        _timeline.OrderBy(n => n.Time).ToList());

    private static string Code(string? errorCode) =>
        errorCode is null ? "" : $" (error {FormatCode(errorCode)})";

    // WDS logs error codes as decimal; Windows people know them as hex (0x80070005).
    private static string FormatCode(string code) =>
        long.TryParse(code, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) && number is < 0 or > 0xFFFF
            ? $"0x{unchecked((uint)number):X8}"
            : code;
}
