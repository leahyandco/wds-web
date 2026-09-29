namespace WdsWeb.Api.Wds;

public enum WdsConnectionMode
{
    /// <summary>The web service runs on the WDS server itself.</summary>
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

    public bool UseSsl { get; set; }

    /// <summary>WinRM port. Defaults to 5985, or 5986 with SSL.</summary>
    public int? Port { get; set; }

    /// <summary>
    /// A PSCredential saved with <c>Get-Credential | Export-Clixml</c>, for Remote mode. Environment
    /// variables are expanded. Without it, the service's own Windows identity is used.
    /// </summary>
    public string? CredentialFile { get; set; }

    /// <summary>How many PowerShell sessions to keep open on the server.</summary>
    public int PoolSize { get; set; } = 3;

    public TimeSpan CommandTimeout { get; set; } = TimeSpan.FromMinutes(2);
}
