using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Options;

namespace WdsWeb.Api.Wds;

/// <summary>
/// The staging folder on the WDS server, where uploads land and imports keep temporary files. This
/// process reaches it directly in Local mode, and in Remote mode through a share: Wds:StagingShare,
/// or else the server's administrative share (C$), connecting with the same credential as the
/// PowerShell sessions.
/// </summary>
public sealed class StagingArea
{
    private readonly WdsOptions _options;
    private readonly WdsSessionPool _pool;
    private readonly Lock _connectLock = new();
    private bool _connected;
    private volatile bool _ready;

    public StagingArea(IOptions<WdsOptions> options, WdsSessionPool pool)
    {
        _options = options.Value;
        _pool = pool;

        ServerRoot = _options.StagingPath.TrimEnd('\\');
        if (ServerRoot.Length < 4 || ServerRoot[1] != ':' || ServerRoot[2] != '\\' || !char.IsAsciiLetter(ServerRoot[0]))
            throw new InvalidOperationException(@"Wds:StagingPath must be a folder on a drive of the WDS server, such as C:\WdsWeb\Staging.");

        if (_options.Mode == WdsConnectionMode.Demo)
        {
            // Nothing is uploaded in the demo, but listing uploads still needs a folder.
            ServerRoot = LocalRoot = Path.Combine(Path.GetTempPath(), "WdsWebDemo");
        }
        else if (_options.Mode == WdsConnectionMode.Local)
        {
            LocalRoot = ServerRoot;
        }
        else if (!string.IsNullOrWhiteSpace(_options.StagingShare))
        {
            LocalRoot = _options.StagingShare.Trim().TrimEnd('\\');
            if (!LocalRoot.StartsWith(@"\\", StringComparison.Ordinal) || LocalRoot.Count(c => c == '\\') < 3)
                throw new InvalidOperationException(@"Wds:StagingShare must be a share such as \\wds01\WdsStaging.");
        }
        else
        {
            LocalRoot = $@"\\{_options.ComputerName}\{ServerRoot[0]}${ServerRoot[2..]}";
        }
    }

    /// <summary>The staging folder as the WDS server sees it, e.g. C:\WdsWeb\Staging.</summary>
    public string ServerRoot { get; }

    /// <summary>Demo mode, which takes no uploads.</summary>
    public bool IsDemo => _options.Mode == WdsConnectionMode.Demo;

    /// <summary>The same folder as this process reaches it: a local path, or a UNC path in Remote mode.</summary>
    public string LocalRoot { get; }

    public string UploadsFolder => Path.Combine(LocalRoot, "uploads");

    public string TempFolder => Path.Combine(LocalRoot, "temp");

    /// <summary>Translates a path under <see cref="LocalRoot"/> into the path the WDS server sees.</summary>
    public string ToServerPath(string localPath)
    {
        if (!localPath.StartsWith(LocalRoot, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException($"{localPath} isn't in the staging folder.", nameof(localPath));
        return ServerRoot + localPath[LocalRoot.Length..];
    }

    /// <summary>Connects to the WDS server's share if needed, and makes sure the folder exists.</summary>
    public void EnsureReady()
    {
        if (_ready) return;
        if (_options.Mode == WdsConnectionMode.Remote) Connect();
        Directory.CreateDirectory(LocalRoot);
        _ready = true;
    }

    /// <summary>Free and total bytes on the staging folder's volume.</summary>
    public (long Free, long Total) GetSpace()
    {
        EnsureReady();
        if (!GetDiskFreeSpaceEx(LocalRoot.EndsWith('\\') ? LocalRoot : LocalRoot + '\\', out var free, out var total, out _))
            throw new IOException($"Couldn't read the free space for {LocalRoot}: {new Win32Exception(Marshal.GetLastWin32Error()).Message}");
        return ((long)free, (long)total);
    }

    private void Connect()
    {
        lock (_connectLock)
        {
            if (_connected) return;

            // \\server\share: the first two parts of the staging folder's UNC path.
            var share = string.Join('\\', LocalRoot.Split('\\').Take(4));
            var credential = _pool.Credential?.GetNetworkCredential();
            var userName = credential is null ? null
                : string.IsNullOrEmpty(credential.Domain) ? credential.UserName
                : $@"{credential.Domain}\{credential.UserName}";

            var result = WNetAddConnection2(new NetResource { RemoteName = share }, credential?.Password, userName, 0);
            // 1219: this Windows logon already has a connection to the server under another
            // credential. Windows allows only one, so use the existing one.
            if (result is not (0 or ErrorSessionCredentialConflict))
                throw new WdsConnectionException($"Couldn't connect to {share}: {new Win32Exception(result).Message}");
            _connected = true;
        }
    }

    private const int ErrorSessionCredentialConflict = 1219;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private sealed class NetResource
    {
        public int Scope;
        public int Type = 1; // RESOURCETYPE_DISK
        public int DisplayType;
        public int Usage;
        public string? LocalName;
        public string? RemoteName;
        public string? Comment;
        public string? Provider;
    }

    [DllImport("mpr.dll", CharSet = CharSet.Unicode)]
    private static extern int WNetAddConnection2(NetResource netResource, string? password, string? userName, int flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetDiskFreeSpaceEx(string directoryName, out ulong freeBytesAvailable, out ulong totalBytes, out ulong totalFreeBytes);
}
