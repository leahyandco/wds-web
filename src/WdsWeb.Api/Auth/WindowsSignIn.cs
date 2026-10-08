using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace WdsWeb.Api.Auth;

public sealed record SignInResult(bool Succeeded, string? Account, string? Reason);

/// <param name="Name">As configured.</param>
/// <param name="Kind">group or user.</param>
/// <param name="Problem">Why it can't be used, e.g. it doesn't exist; null when it can.</param>
public sealed record AllowedAccount(string Name, string Kind, string? Problem)
{
    public bool Resolved => Problem is null;
}

/// <summary>
/// Checks a user name and password with Windows on this machine, so local accounts work, and domain
/// accounts when the machine is in a domain. The account must be one of the allowed users or a member
/// of one of the allowed groups. A network logon is used: it needs no right to sign in interactively,
/// and for domain accounts it carries full group membership (UAC doesn't filter it).
/// </summary>
public sealed class WindowsSignIn(IOptions<AuthOptions> options, ILogger<WindowsSignIn> logger)
{
    private const int Logon32LogonNetwork = 3;
    private const int Logon32ProviderDefault = 0;
    private static readonly TimeSpan RetryLookupsAfter = TimeSpan.FromMinutes(5);

    // Looking names up can mean asking a domain controller, so it's done once; but a lookup that failed
    // (rather than finding nothing) is tried again a little later, in case the DC was out of reach.
    private Resolution? _resolution;

    /// <summary>The configured groups and users, and whether each can be used.</summary>
    public IReadOnlyList<AllowedAccount> Allowed => Current.Accounts;

    private Resolution Current
    {
        get
        {
            var current = _resolution;
            if (current is null || (current.LookupFailed && DateTimeOffset.UtcNow - current.At > RetryLookupsAfter))
                _resolution = current = Resolve(options.Value, logger);
            return current;
        }
    }

    public SignInResult Check(string userName, string password)
    {
        var (user, domain) = Split(userName.Trim());
        if (!LogonUser(user, domain, password, Logon32LogonNetwork, Logon32ProviderDefault, out var token))
            return new SignInResult(false, null, new Win32Exception(Marshal.GetLastWin32Error()).Message);

        using (token)
        using (var identity = new WindowsIdentity(token.DangerousGetHandle()))
        {
            var sids = (identity.Groups ?? []).OfType<SecurityIdentifier>().Append(identity.User!);
            return sids.Any(Current.Sids.Contains)
                ? new SignInResult(true, identity.Name, null)
                : new SignInResult(false, identity.Name, "The account isn't an allowed user or in an allowed group.");
        }
    }

    /// <summary>Logs who may sign in, and any configured name Windows can't find, so a typo shows up at startup.</summary>
    public void LogAllowed()
    {
        var accounts = Allowed;
        foreach (var unusable in accounts.Where(a => !a.Resolved))
            logger.LogWarning("The allowed {Kind} {Name} is ignored: {Problem}", unusable.Kind, unusable.Name, unusable.Problem);
        if (accounts.Any(a => a.Resolved))
            logger.LogInformation("Sign-in is allowed for {Accounts}", string.Join(", ", accounts.Where(a => a.Resolved).Select(a => $"{a.Name} ({a.Kind})")));
        else
            logger.LogError("Nobody can sign in: none of the groups and users in Auth:AllowedGroups and Auth:AllowedUsers exist.");
    }

    /// <summary>DOMAIN\user and user@domain name their domain; a bare name is a local account.</summary>
    internal static (string User, string? Domain) Split(string userName)
    {
        var slash = userName.IndexOf('\\');
        if (slash > 0) return (userName[(slash + 1)..], userName[..slash]);
        return userName.Contains('@') ? (userName, null) : (userName, ".");
    }

    /// <summary>The groups and users to check, falling back to the local Administrators group when none are configured.</summary>
    internal static IEnumerable<(string Name, string Kind)> Configured(AuthOptions options) =>
        options.AllowedGroups.Length == 0 && options.AllowedUsers.Length == 0
            ? AuthOptions.DefaultAllowedGroups.Select(g => (g, "group"))
            : options.AllowedGroups.Select(g => (g, "group")).Concat(options.AllowedUsers.Select(u => (u, "user")));

    private static Resolution Resolve(AuthOptions options, ILogger logger)
    {
        var sids = new HashSet<SecurityIdentifier>();
        var accounts = new List<AllowedAccount>();
        var lookupFailed = false;
        foreach (var (name, kind) in Configured(options))
        {
            try
            {
                sids.Add((SecurityIdentifier)new NTAccount(name).Translate(typeof(SecurityIdentifier)));
                accounts.Add(new AllowedAccount(name, kind, null));
            }
            catch (IdentityNotMappedException)
            {
                accounts.Add(new AllowedAccount(name, kind, "Windows can't find it"));
            }
            catch (SystemException ex)
            {
                // A malformed name, or no answer from a domain controller.
                logger.LogDebug(ex, "Looking up the allowed {Kind} {Name} failed", kind, name);
                accounts.Add(new AllowedAccount(name, kind, $"looking it up failed: {ex.Message}"));
                lookupFailed = true;
            }
        }
        return new Resolution(sids, accounts, lookupFailed, DateTimeOffset.UtcNow);
    }

    private sealed record Resolution(IReadOnlySet<SecurityIdentifier> Sids, IReadOnlyList<AllowedAccount> Accounts, bool LookupFailed, DateTimeOffset At);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LogonUser(string userName, string? domain, string password, int logonType, int logonProvider, out SafeAccessTokenHandle token);
}
