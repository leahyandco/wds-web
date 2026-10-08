using System.Globalization;
using System.Text.RegularExpressions;

namespace WdsWeb.Api.Wds;

/// <summary>An event from one of WDS's logs, with its named fields (ClientIP and so on).</summary>
public sealed record WdsEventRecord(DateTimeOffset Time, int Id, IReadOnlyDictionary<string, string> Data);

public enum BootStatus
{
    /// <summary>The client asked WDS to PXE boot but downloaded nothing from it.</summary>
    PxeOnly,

    /// <summary>
    /// The client ran WDS's boot program and went no further: usually its network boot prompt (F12, or
    /// Enter on UEFI) wasn't answered, or it's waiting for approval.
    /// </summary>
    BootProgram,

    /// <summary>The client got as far as the boot menu but hasn't started a boot image (yet).</summary>
    BootMenu,

    Downloading,

    /// <summary>A boot image finished downloading, so the client is running WinPE.</summary>
    Loaded,

    Failed,

    /// <summary>A boot image download never finished: it stopped long ago, or the client has booted again since.</summary>
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

    /// <summary>WDS ignored the PXE request: the client isn't prestaged, and WDS answers only known clients.</summary>
    NotRecognized,
}

/// <summary>Something WDS logged about a boot besides its downloads.</summary>
public sealed record BootNote(DateTimeOffset Time, BootNoteKind Kind);

/// <summary>One client's PXE boot, the files it then fetched over TFTP, and the install that followed.</summary>
/// <param name="Deployment">The WDS client's progress; only logged while WDS client logging is on.</param>
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
    IReadOnlyList<BootNote> Notes,
    Deployment? Deployment = null);

/// <summary>
/// Pieces WDS's PXE (4096) and TFTP (4099 started, 4100 completed, 4101 failed) events into
/// per-client boot sessions. WDS logs the PXE request more than once per boot (before and after the
/// network boot prompt), and the TFTP events carry only the client's IP, so events are grouped by IP.
/// A new session starts after a quiet gap, or when the client boots again once it had got past WDS's
/// boot program: a PXE request, or a fresh download of the boot program, which firmware can fetch again
/// without WDS logging another request. Until then, repeated tries at the prompt count as one boot.
/// The image server's refusals of unattend requests (WDSIMGSRV 270) also carry only the IP, and are
/// added to the session they belong to. With WDS client logging on, the WDS client's own events
/// (see <see cref="DeploymentEvents"/>) follow the install; they carry the MAC address too, which
/// finds the session even when WinPE got a different address from the PXE boot.
/// </summary>
public static partial class BootActivity
{
    public const int PxeBoot = 4096;
    public const int TftpStarted = 4099;
    public const int TftpCompleted = 4100;
    public const int TftpFailed = 4101;
    public const int NotRecognized = 4132;
    public const int UnattendBlocked = 270;

    private static readonly TimeSpan SessionGap = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan StalledAfter = TimeSpan.FromMinutes(15);

    /// <summary>How far back a TFTP finish looks for its start: far longer than any boot image takes.</summary>
    private static readonly TimeSpan LongestDownload = TimeSpan.FromHours(2);

    /// <summary>Applying a big image can leave the WDS client quiet for a long time.</summary>
    private static readonly TimeSpan DeploymentGap = TimeSpan.FromHours(6);

    public static IReadOnlyList<BootSession> Build(IEnumerable<WdsEventRecord> events, DateTimeOffset now)
    {
        var sessions = new List<Session>();
        var byIp = new Dictionary<string, Session>(StringComparer.OrdinalIgnoreCase);
        var byMac = new Dictionary<string, Session>();

        foreach (var record in events.OrderBy(e => e.Time))
        {
            if (record.Data.GetValueOrDefault("ClientIP") is not { Length: > 0 } ip) continue;
            byIp.TryGetValue(ip, out var session);

            if (DeploymentEvents.IsDeploymentEvent(record.Id))
            {
                var clientMac = record.Data.GetValueOrDefault("ClientMAC");
                if (MacKey(clientMac) is { } key && byMac.TryGetValue(key, out var sameMachine)) session = sameMachine;
                var gap = session?.Deployment is { Active: true } ? DeploymentGap : SessionGap;
                if (session is null || record.Time - session.LastSeen > gap) session = Start(ip, record.Time);
                session.Deployment ??= new DeploymentBuilder(record.Time);
                session.Deployment.Apply(record);
                session.MacAddress ??= clientMac;
                session.DeviceId ??= record.Data.GetValueOrDefault("ClientDeviceID");
                // WinPE's address, for later events that carry only an IP (such as WDSIMGSRV 270).
                byIp[ip] = session;
                Remember(session);
                session.LastSeen = record.Time;
                continue;
            }

            switch (record.Id)
            {
                case PxeBoot or NotRecognized:
                    var mac = record.Data.GetValueOrDefault("ClientHardwareAddress");
                    bool? prestaged = bool.TryParse(record.Data.GetValueOrDefault("ClientPrestaged"), out var known) ? known : null;
                    if (session is null || record.Time - session.LastSeen > SessionGap || session.Progressed ||
                        (session.MacAddress is not null && mac is not null && MacKey(mac) != MacKey(session.MacAddress)) ||
                        // Prestaged (or removed) since its last try, so WDS answers it differently now.
                        (session.Prestaged is not null && prestaged is not null && session.Prestaged != prestaged))
                    {
                        session = Start(ip, record.Time);
                    }
                    session.MacAddress ??= mac;
                    session.DeviceId ??= record.Data.GetValueOrDefault("ClientDeviceID");
                    session.ArchitectureCode ??= ParseInt(record.Data.GetValueOrDefault("ClientArch"));
                    session.Prestaged ??= prestaged;
                    if (record.Id == NotRecognized && session.Notes.All(n => n.Kind != BootNoteKind.NotRecognized))
                        session.Notes.Add(new BootNote(record.Time, BootNoteKind.NotRecognized));
                    Remember(session);
                    break;

                case TftpStarted:
                    var file = record.Data.GetValueOrDefault("FileName") ?? "";
                    if (session is null || record.Time - session.LastSeen > SessionGap) session = Start(ip, record.Time);
                    else if (session.Progressed && FirstBootProgram().IsMatch(file)) session = Start(ip, record.Time, sameClientAs: session);
                    session.Transfers.Add(new Transfer(file, ParseLong(record.Data.GetValueOrDefault("FileSize")), record.Time));
                    break;

                case TftpCompleted or TftpFailed:
                    var fileName = record.Data.GetValueOrDefault("FileName") ?? "";
                    var (owner, transfer) = Unfinished(ip, fileName, record.Time);
                    if (owner is not null)
                    {
                        session = owner;
                    }
                    else
                    {
                        if (session is null || record.Time - session.LastSeen > SessionGap) session = Start(ip, record.Time);
                        // The start scrolled out of the log; record the finish on its own.
                        transfer = new Transfer(fileName, ParseLong(record.Data.GetValueOrDefault("FileSize")), null);
                        session.Transfers.Add(transfer);
                    }
                    transfer!.FinishedAt = record.Time;
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

        // Newest boot first, by when it began: a late event, such as a failure logged for a download cut short,
        // doesn't move an old boot up the list.
        return sessions.OrderByDescending(s => s.FirstSeen).Select(s => s.Build(now)).ToList();

        // sameClientAs: the session this boot follows on from moments later, when the new boot's own PXE
        // request (which says who the client is) wasn't logged.
        Session Start(string ip, DateTimeOffset time, Session? sameClientAs = null)
        {
            // Whatever the client was doing at this address before, it has stopped.
            if (byIp.TryGetValue(ip, out var previous)) previous.Superseded = true;
            var session = new Session(ip, time)
            {
                MacAddress = sameClientAs?.MacAddress,
                DeviceId = sameClientAs?.DeviceId,
                ArchitectureCode = sameClientAs?.ArchitectureCode,
            };
            sessions.Add(session);
            byIp[ip] = session;
            return session;
        }

        void Remember(Session session)
        {
            if (MacKey(session.MacAddress) is { } key) byMac[key] = session;
        }

        // The download a TFTP finish belongs to: usually in the client's current session, but if the client
        // was reset mid-download and has booted again since, in the one before.
        (Session?, Transfer?) Unfinished(string ip, string fileName, DateTimeOffset finished)
        {
            foreach (var candidate in Enumerable.Reverse(sessions))
            {
                if (finished - candidate.FirstSeen > LongestDownload) break;
                if (!candidate.ClientIp.Equals(ip, StringComparison.OrdinalIgnoreCase)) continue;
                var transfer = candidate.Transfers.LastOrDefault(t =>
                    t.FinishedAt is null && t.FileName.Equals(fileName, StringComparison.OrdinalIgnoreCase));
                if (transfer is not null) return (candidate, transfer);
            }
            return (null, null);
        }
    }

    /// <summary>A MAC address in one spelling, whatever separators an event used.</summary>
    private static string? MacKey(string? mac)
    {
        if (mac is null) return null;
        var hex = new string(mac.Where(char.IsAsciiHexDigit).ToArray()).ToUpperInvariant();
        return hex.Length == 12 ? hex : null;
    }

    private static int? ParseInt(string? value) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) ? number : null;

    private static long? ParseLong(string? value) =>
        long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) ? number : null;

    // WDS names each client's boot menu (its BCD) after an architecture, e.g. \Tmp\x64uefi{GUID}.bcd, though
    // not always with the firmware: a prestaged device's can be \Tmp\x64{GUID}.bcd.
    [GeneratedRegex(@"\\Tmp\\(?<arch>x86|x64|arm64|arm|ia64)(?<uefi>uefi)?\{[0-9A-Fa-f-]+\}\.bcd$", RegexOptions.IgnoreCase)]
    private static partial Regex ClientBcd();

    // What a client fetches first from WDS: wdsnbp.com and pxeboot (BIOS), wdsmgfw.efi (UEFI), which show
    // the network boot prompt, or abortpxe.com.
    [GeneratedRegex(@"(?:^|\\)(?:wdsnbp\.com|pxeboot\.com|pxeboot\.n12|wdsmgfw\.efi|abortpxe\.com)$", RegexOptions.IgnoreCase)]
    private static partial Regex FirstBootProgram();

    // Boot programs and boot managers live in boot\<architecture>; .efi files are for UEFI, the rest for BIOS.
    [GeneratedRegex(@"^\\?boot\\(?<arch>x86|x64|arm64|arm|ia64)\\[^\\]+\.(?<ext>efi|com|n12|exe)$", RegexOptions.IgnoreCase)]
    private static partial Regex BootFile();

    // The Windows boot manager, which WDS's boot program hands over to once the prompt is answered.
    [GeneratedRegex(@"(?:^|\\)(?:bootmgfw\.efi|bootmgr\.exe)$", RegexOptions.IgnoreCase)]
    private static partial Regex BootManager();

    private static bool IsBootImage(string fileName) => fileName.EndsWith(".wim", StringComparison.OrdinalIgnoreCase);

    /// <summary>The boot menu, or the RAM disk that comes with a boot image: the client got past the prompt.</summary>
    private static bool IsPastBootProgram(string fileName) =>
        IsBootImage(fileName) || ClientBcd().IsMatch(fileName) || fileName.EndsWith("\\Boot.SDI", StringComparison.OrdinalIgnoreCase);

    private static string ArchitectureName(string arch) => arch.ToLowerInvariant() switch
    {
        "arm" => "ARM",
        "arm64" => "ARM64",
        "ia64" => "Itanium",
        var other => other,
    };

    /// <summary>The client's architecture and firmware, such as "x64 UEFI", from the files it fetched.</summary>
    private static string? ArchitectureOf(IReadOnlyList<Transfer> transfers)
    {
        // The last boot file says the most: BIOS clients start with boot\x86\wdsnbp.com whatever they are.
        if (transfers.Select(t => BootFile().Match(t.FileName)).LastOrDefault(m => m.Success) is { } boot)
        {
            var firmware = boot.Groups["ext"].Value.Equals("efi", StringComparison.OrdinalIgnoreCase) ? "UEFI" : "BIOS";
            return $"{ArchitectureName(boot.Groups["arch"].Value)} {firmware}";
        }
        if (transfers.Select(t => ClientBcd().Match(t.FileName)).FirstOrDefault(m => m.Success) is { } bcd)
            return ArchitectureName(bcd.Groups["arch"].Value) + (bcd.Groups["uefi"].Success ? " UEFI" : "");
        return null;
    }

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
        public DeploymentBuilder? Deployment { get; set; }

        /// <summary>A later session from the same address has started, so nothing here is still going.</summary>
        public bool Superseded { get; set; }

        /// <summary>WinPE is (or was) running: the boot image downloaded, or Setup has been heard from since.</summary>
        public bool LoadedImage =>
            Transfers.Any(t => IsBootImage(t.FileName) && t.Succeeded == true) ||
            Deployment is not null ||
            Notes.Any(n => n.Kind == BootNoteKind.UnattendBlocked);

        /// <summary>Got past WDS's boot program, so a PXE request from now on is the client booting again.</summary>
        public bool Progressed => LoadedImage || Transfers.Any(t => IsPastBootProgram(t.FileName));

        public BootSession Build(DateTimeOffset now)
        {
            var image = Transfers.LastOrDefault(t => IsBootImage(t.FileName));

            return new BootSession(
                ClientIp, MacAddress, DeviceId, ArchitectureOf(Transfers), ArchitectureCode, Prestaged, FirstSeen, LastSeen,
                StatusOf(image, now), image?.FileName, Transfers.Select(t => t.Build()).ToList(), Notes, Deployment?.Build());
        }

        private BootStatus StatusOf(Transfer? image, DateTimeOffset now)
        {
            // The download may have scrolled out of the log, but Setup only runs once WinPE has loaded.
            if (image?.Succeeded == true || (image is null && LoadedImage)) return BootStatus.Loaded;
            if (Transfers.Any(t => t.Succeeded == false)) return BootStatus.Failed;
            if (image is null)
            {
                return Transfers.Any(t => ClientBcd().IsMatch(t.FileName) || BootManager().IsMatch(t.FileName)) ? BootStatus.BootMenu
                    : Transfers.Count > 0 ? BootStatus.BootProgram
                    : BootStatus.PxeOnly;
            }
            // A reset or power-off mid-download logs no failure: the download just never finishes.
            return Superseded || now - LastSeen > StalledAfter ? BootStatus.Incomplete : BootStatus.Downloading;
        }
    }
}
