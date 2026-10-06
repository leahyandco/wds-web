using System.Globalization;
using System.Text.RegularExpressions;

namespace WdsWeb.Api.Wds;

/// <summary>An event from one of WDS's logs, with its named fields (ClientIP and so on).</summary>
public sealed record WdsEventRecord(DateTimeOffset Time, int Id, IReadOnlyDictionary<string, string> Data);

public enum BootStatus
{
    /// <summary>The client asked for a boot program but never fetched one (e.g. F12 not pressed).</summary>
    PxeOnly,

    /// <summary>The client loaded the WDS boot manager but hasn't fetched a boot image (yet).</summary>
    BootMenu,

    Downloading,

    /// <summary>A boot image finished downloading, so the client is running WinPE.</summary>
    Loaded,

    Failed,

    /// <summary>A boot image download started long ago and never reported finishing.</summary>
    Incomplete,
}

public sealed record TftpTransfer(
    string FileName,
    long? FileSize,
    DateTimeOffset? StartedAt,
    DateTimeOffset? FinishedAt,
    bool? Succeeded,
    string? ErrorCode);

public enum BootNoteKind
{
    /// <summary>WDS refused Windows Setup's request for the WDS client unattend file (hands-free deployment is off).</summary>
    UnattendBlocked,
}

/// <summary>Something that happened later in a boot, after the boot image loaded.</summary>
public sealed record BootNote(DateTimeOffset Time, BootNoteKind Kind);

/// <summary>One client's PXE boot and the files it then fetched over TFTP.</summary>
public sealed record BootSession(
    string ClientIp,
    string? MacAddress,
    string? DeviceId,
    string? Architecture,
    int? ArchitectureCode,
    bool? Prestaged,
    DateTimeOffset FirstSeen,
    DateTimeOffset LastSeen,
    BootStatus Status,
    string? BootImage,
    IReadOnlyList<TftpTransfer> Transfers,
    IReadOnlyList<BootNote> Notes);

/// <summary>
/// Pieces WDS's PXE (4096) and TFTP (4099 started, 4100 completed, 4101 failed) events into
/// per-client boot sessions. WDS logs the PXE request more than once per boot (before and after the
/// F12 prompt), and the TFTP events carry only the client's IP, so events are grouped by IP, and a
/// new session starts after a quiet gap or when the client PXE-boots again after loading an image.
/// The image server's refusals of unattend requests (WDSIMGSRV 270) also carry only the IP, and are
/// added to the session they belong to.
/// </summary>
public static partial class BootActivity
{
    public const int PxeBoot = 4096;
    public const int TftpStarted = 4099;
    public const int TftpCompleted = 4100;
    public const int TftpFailed = 4101;
    public const int UnattendBlocked = 270;

    private static readonly TimeSpan SessionGap = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan StalledAfter = TimeSpan.FromMinutes(15);

    public static IReadOnlyList<BootSession> Build(IEnumerable<WdsEventRecord> events, DateTimeOffset now)
    {
        var sessions = new List<Session>();
        var byIp = new Dictionary<string, Session>(StringComparer.OrdinalIgnoreCase);

        foreach (var record in events.OrderBy(e => e.Time))
        {
            if (record.Data.GetValueOrDefault("ClientIP") is not { Length: > 0 } ip) continue;
            byIp.TryGetValue(ip, out var session);

            switch (record.Id)
            {
                case PxeBoot:
                    var mac = record.Data.GetValueOrDefault("ClientHardwareAddress");
                    if (session is null || record.Time - session.LastSeen > SessionGap || session.LoadedImage ||
                        (session.MacAddress is not null && mac is not null && !mac.Equals(session.MacAddress, StringComparison.OrdinalIgnoreCase)))
                    {
                        session = Start(ip, record.Time);
                    }
                    session.MacAddress ??= mac;
                    session.DeviceId ??= record.Data.GetValueOrDefault("ClientDeviceID");
                    session.ArchitectureCode ??= ParseInt(record.Data.GetValueOrDefault("ClientArch"));
                    session.Prestaged ??= bool.TryParse(record.Data.GetValueOrDefault("ClientPrestaged"), out var prestaged) ? prestaged : null;
                    break;

                case TftpStarted:
                    if (session is null || record.Time - session.LastSeen > SessionGap) session = Start(ip, record.Time);
                    session.Transfers.Add(new Transfer(record.Data.GetValueOrDefault("FileName") ?? "", ParseLong(record.Data.GetValueOrDefault("FileSize")), record.Time));
                    break;

                case TftpCompleted or TftpFailed:
                    if (session is null || record.Time - session.LastSeen > SessionGap) session = Start(ip, record.Time);
                    var fileName = record.Data.GetValueOrDefault("FileName") ?? "";
                    // The start may have scrolled out of the log; then record the finish on its own.
                    var transfer = session.Transfers.LastOrDefault(t => t.FinishedAt is null && t.FileName.Equals(fileName, StringComparison.OrdinalIgnoreCase));
                    if (transfer is null)
                    {
                        transfer = new Transfer(fileName, ParseLong(record.Data.GetValueOrDefault("FileSize")), null);
                        session.Transfers.Add(transfer);
                    }
                    transfer.FinishedAt = record.Time;
                    transfer.Succeeded = record.Id == TftpCompleted;
                    transfer.ErrorCode = record.Data.GetValueOrDefault("ErrorCode");
                    break;

                case UnattendBlocked:
                    // Setup asks once WinPE is up, so this belongs to the boot that loaded the image.
                    if (session is null || record.Time - session.LastSeen > SessionGap) session = Start(ip, record.Time);
                    session.Notes.Add(new BootNote(record.Time, BootNoteKind.UnattendBlocked));
                    break;

                default:
                    continue;
            }

            session.LastSeen = record.Time;
        }

        return sessions.OrderByDescending(s => s.LastSeen).Select(s => s.Build(now)).ToList();

        Session Start(string ip, DateTimeOffset time)
        {
            var session = new Session(ip, time);
            sessions.Add(session);
            byIp[ip] = session;
            return session;
        }
    }

    private static int? ParseInt(string? value) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) ? number : null;

    private static long? ParseLong(string? value) =>
        long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) ? number : null;

    // WDS names each client's boot configuration after its architecture, e.g. \Tmp\x64uefi{GUID}.bcd.
    [GeneratedRegex(@"\\Tmp\\(?<arch>[A-Za-z0-9]+)\{[0-9A-Fa-f-]+\}\.bcd$")]
    private static partial Regex ClientBcd();

    private static bool IsBootImage(string fileName) => fileName.EndsWith(".wim", StringComparison.OrdinalIgnoreCase);

    private sealed class Transfer(string fileName, long? fileSize, DateTimeOffset? startedAt)
    {
        public string FileName { get; } = fileName;
        public long? FileSize { get; } = fileSize;
        public DateTimeOffset? StartedAt { get; } = startedAt;
        public DateTimeOffset? FinishedAt { get; set; }
        public bool? Succeeded { get; set; }
        public string? ErrorCode { get; set; }

        public TftpTransfer Build() => new(FileName, FileSize, StartedAt, FinishedAt, Succeeded, ErrorCode);
    }

    private sealed class Session(string clientIp, DateTimeOffset firstSeen)
    {
        public string ClientIp { get; } = clientIp;
        public DateTimeOffset FirstSeen { get; } = firstSeen;
        public DateTimeOffset LastSeen { get; set; } = firstSeen;
        public string? MacAddress { get; set; }
        public string? DeviceId { get; set; }
        public int? ArchitectureCode { get; set; }
        public bool? Prestaged { get; set; }
        public List<Transfer> Transfers { get; } = [];
        public List<BootNote> Notes { get; } = [];

        public bool LoadedImage => Transfers.Any(t => IsBootImage(t.FileName) && t.Succeeded == true);

        public BootSession Build(DateTimeOffset now)
        {
            var image = Transfers.LastOrDefault(t => IsBootImage(t.FileName));
            var architecture = Transfers
                .Select(t => ClientBcd().Match(t.FileName))
                .FirstOrDefault(m => m.Success)?.Groups["arch"].Value;

            return new BootSession(
                ClientIp, MacAddress, DeviceId, architecture, ArchitectureCode, Prestaged, FirstSeen, LastSeen,
                StatusOf(image, now), image?.FileName, Transfers.Select(t => t.Build()).ToList(), Notes);
        }

        private BootStatus StatusOf(Transfer? image, DateTimeOffset now)
        {
            if (Transfers.Any(t => t.Succeeded == false)) return BootStatus.Failed;
            if (image is null) return Transfers.Count > 0 ? BootStatus.BootMenu : BootStatus.PxeOnly;
            if (image.Succeeded == true) return BootStatus.Loaded;
            return now - LastSeen > StalledAfter ? BootStatus.Incomplete : BootStatus.Downloading;
        }
    }
}
