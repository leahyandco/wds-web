namespace WdsWeb.Api.Auth;

/// <summary>Who may sign in. Bound from the "Auth" configuration section.</summary>
public sealed class AuthOptions
{
    public const string SectionName = "Auth";

    /// <summary>Off only for local development, where the service listens on localhost alone.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Windows groups (local or domain) whose members may sign in. Left empty,
    /// <see cref="DefaultAllowedGroups"/> is used. (Not defaulted here because the configuration binder
    /// appends to an array rather than replacing it.)
    /// </summary>
    public string[] AllowedGroups { get; set; } = [];

    public static readonly string[] DefaultAllowedGroups = [@"BUILTIN\Administrators"];

    public TimeSpan SessionLifetime { get; set; } = TimeSpan.FromHours(8);
}
