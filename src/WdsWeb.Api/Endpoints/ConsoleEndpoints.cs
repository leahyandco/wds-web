using System.Reflection;
using System.Security.Principal;
using Microsoft.Extensions.Options;
using WdsWeb.Api.Auth;
using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Endpoints;

/// <summary>Facts about this install that only Program knows, such as where its settings file is.</summary>
public sealed record ConsoleInfo(string SettingsFile)
{
    /// <summary>The release, e.g. 0.1.0, with the commit it was built from when known (0.1.0+3952918).</summary>
    public static string Version { get; } = ReadVersion();

    private static string ReadVersion()
    {
        var version = typeof(ConsoleInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";
        // The SDK appends the full commit hash; seven characters are plenty to find it.
        var plus = version.IndexOf('+');
        return plus >= 0 && version.Length > plus + 8 ? version[..(plus + 8)] : version;
    }
}

/// <summary>How this console is set up, for the people using it.</summary>
public static class ConsoleEndpoints
{
    public static void MapConsoleEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/console", (ConsoleInfo info, IOptions<WdsOptions> wds, IOptions<AuthOptions> auth, WindowsSignIn signIn,
            WdsSessionPool pool, StagingArea staging) =>
        {
            var serviceAccount = WindowsIdentity.GetCurrent().Name;
            return new ConsoleResponse(
                ConsoleInfo.Version,
                pool.Mode,
                pool.TargetName,
                Environment.MachineName,
                ConnectsAs(pool, wds.Value, serviceAccount),
                serviceAccount,
                info.SettingsFile,
                File.Exists(info.SettingsFile),
                staging.ServerRoot,
                staging.LocalRoot,
                auth.Value.Enabled,
                auth.Value.Enabled ? signIn.Allowed : [],
                auth.Value.SessionLifetime);
        });
    }

    // Who the WDS server sees: the stored credential's account, or this service's own.
    private static string ConnectsAs(WdsSessionPool pool, WdsOptions wds, string serviceAccount)
    {
        if (pool.Mode == WdsConnectionMode.Local) return serviceAccount;
        if (string.IsNullOrWhiteSpace(wds.CredentialFile))
        {
            // Over the network, the machine's built-in accounts act as the computer's domain account.
            return serviceAccount is @"NT AUTHORITY\SYSTEM" or @"NT AUTHORITY\NETWORK SERVICE"
                ? $@"{Environment.UserDomainName}\{Environment.MachineName}$ (this computer's account)"
                : serviceAccount;
        }
        try
        {
            return pool.Credential?.UserName ?? serviceAccount;
        }
        catch (WdsConnectionException ex)
        {
            return ex.Message;
        }
    }
}

/// <param name="ConnectsAs">The account the WDS server sees the console as.</param>
/// <param name="ServiceAccount">The account the console itself runs as.</param>
/// <param name="StagingPath">The staging folder as the WDS server sees it.</param>
/// <param name="StagingAccess">The same folder as the console reaches it (a share, in Remote mode).</param>
public sealed record ConsoleResponse(
    string Version,
    WdsConnectionMode Mode,
    string Server,
    string ConsoleHost,
    string ConnectsAs,
    string ServiceAccount,
    string SettingsFile,
    bool SettingsFileExists,
    string StagingPath,
    string StagingAccess,
    bool SignInRequired,
    IReadOnlyList<AllowedAccount> AllowedAccounts,
    TimeSpan SessionLifetime);
