using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace WdsWeb.Api.Auth;

public sealed record SignInResult(bool Succeeded, string? Account, string? Reason);

/// <summary>
/// Checks a user name and password with Windows on this machine, so local accounts work, and domain
/// accounts when the machine is in a domain. The account must be in one of the allowed groups. A
/// network logon is used: it needs no right to sign in interactively, and for domain accounts it
/// carries full group membership (UAC doesn't filter it).
/// </summary>
public sealed class WindowsSignIn(IOptions<AuthOptions> options, ILogger<WindowsSignIn> logger)
{
    private const int Logon32LogonNetwork = 3;
    private const int Logon32ProviderDefault = 0;

    private readonly Lazy<IReadOnlySet<SecurityIdentifier>> _allowed = new(() => ResolveGroups(options.Value, logger));

    public SignInResult Check(string userName, string password)
    {
        var (user, domain) = Split(userName.Trim());
        if (!LogonUser(user, domain, password, Logon32LogonNetwork, Logon32ProviderDefault, out var token))
            return new SignInResult(false, null, new Win32Exception(Marshal.GetLastWin32Error()).Message);

        using (token)
        using (var identity = new WindowsIdentity(token.DangerousGetHandle()))
        {
            var sids = (identity.Groups ?? []).OfType<SecurityIdentifier>().Append(identity.User!);
            return sids.Any(_allowed.Value.Contains)
                ? new SignInResult(true, identity.Name, null)
                : new SignInResult(false, identity.Name, "The account isn't in any of the allowed groups.");
        }
    }

    /// <summary>DOMAIN\user and user@domain name their domain; a bare name is a local account.</summary>
    internal static (string User, string? Domain) Split(string userName)
    {
        var slash = userName.IndexOf('\\');
        if (slash > 0) return (userName[(slash + 1)..], userName[..slash]);
        return userName.Contains('@') ? (userName, null) : (userName, ".");
    }

    private static IReadOnlySet<SecurityIdentifier> ResolveGroups(AuthOptions options, ILogger logger)
    {
        var sids = new HashSet<SecurityIdentifier>();
        foreach (var name in options.AllowedGroups is { Length: > 0 } groups ? groups : AuthOptions.DefaultAllowedGroups)
        {
            try
            {
                sids.Add((SecurityIdentifier)new NTAccount(name).Translate(typeof(SecurityIdentifier)));
            }
            catch (IdentityNotMappedException)
            {
                logger.LogWarning("The allowed group {Group} doesn't exist, so it's ignored", name);
            }
        }
        return sids;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LogonUser(string userName, string? domain, string password, int logonType, int logonProvider, out SafeAccessTokenHandle token);
}
