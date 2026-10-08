namespace WdsWeb.Api.Wds;

public enum WdsConnectionMode
{
    /// <summary>The console runs on the WDS server itself.</summary>
    Local,

    /// <summary>The WDS server is another machine, reached over WinRM.</summary>
    Remote,
}

/// <summary>How to reach the WDS server. Bound from the "Wds" configuration section.</summary>
public sealed class WdsOptions
{
    public const string SectionName = "Wds";

    public WdsConnectionMode Mode { get; set; } = WdsConnectionMode.Local;

    /// <summary>The WDS server's name, for Remote mode.</summary>
    public string? ComputerName { get; set; }

    /// <summary>Connect to WinRM over HTTPS, which needs a WinRM HTTPS listener on the WDS server.</summary>
    public bool UseSsl { get; set; }

    /// <summary>WinRM port. Defaults to 5985, or 5986 with SSL.</summary>
    public int? Port { get; set; }

    /// <summary>
    /// The account Remote mode connects as (see <see cref="StoredCredential"/>): credential.json written
    /// by Install-WdsWeb.ps1, or an Export-Clixml'd PSCredential. Environment variables are expanded.
    /// Without it, the console connects as the account its service runs as; for the default
    /// LocalSystem that's this computer's domain account, which then has to be an administrator on the
    /// WDS server.
    /// </summary>
    public string? CredentialFile { get; set; }

    /// <summary>How many PowerShell sessions to keep open on the server.</summary>
    public int PoolSize { get; set; } = 3;

    public TimeSpan CommandTimeout { get; set; } = TimeSpan.FromMinutes(2);

    /// <summary>
    /// A folder on the WDS server for uploads and for temporary files during imports. It's kept out
    /// of RemoteInstall, which WDS owns and serves over TFTP.
    /// </summary>
    public string StagingPath { get; set; } = @"C:\WdsWeb\Staging";

    /// <summary>
    /// Remote mode: the share that reaches <see cref="StagingPath"/> from the console's machine, such as
    /// \\wds01\WdsStaging. Left empty, the WDS server's administrative share is used (\\wds01\C$\WdsWeb\Staging).
    /// </summary>
    public string? StagingShare { get; set; }

    /// <summary>
    /// Folders on the WDS server to offer .iso, .wim and .esd files from, wildcards allowed. Left
    /// empty, <see cref="DefaultImageSearchPaths"/> is used. (Not defaulted here because the
    /// configuration binder appends to an array rather than replacing it.)
    /// </summary>
    public string[] ImageSearchPaths { get; set; } = [];

    public static readonly string[] DefaultImageSearchPaths = [@"C:\Users\*\Downloads", @"C:\ISO", @"C:\ISOs", @"C:\Images"];

    /// <summary>How long a single job, such as an image import, may run.</summary>
    public TimeSpan JobTimeout { get; set; } = TimeSpan.FromHours(3);
}
