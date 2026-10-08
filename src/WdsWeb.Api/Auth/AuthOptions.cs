namespace WdsWeb.Api.Auth;

/// <summary>Who may sign in. Bound from the "Auth" configuration section.</summary>
public sealed class AuthOptions
{
    public const string SectionName = "Auth";

    /// <summary>Off only for local development, where the service listens on localhost alone.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Windows groups, local or domain, whose members may sign in, such as BUILTIN\Administrators or
    /// CONTOSO\WDS Admins. With neither these nor <see cref="AllowedUsers"/> set, the local
    /// Administrators group is allowed (<see cref="DefaultAllowedGroups"/>).
    /// </summary>
    public string[] AllowedGroups { get; set; } = [];

    /// <summary>Individual Windows accounts that may sign in, such as CONTOSO\jdoe, jdoe@contoso.com or WDS01\operator.</summary>
    public string[] AllowedUsers { get; set; } = [];

    public static readonly string[] DefaultAllowedGroups = [@"BUILTIN\Administrators"];

    public TimeSpan SessionLifetime { get; set; } = TimeSpan.FromHours(8);

    /// <summary>
    /// A list setting as configured: a JSON array, or a single string of names separated by semicolons
    /// or commas, which is easier to give in an environment variable (Auth__AllowedGroups). Windows
    /// account and group names can't contain either separator.
    /// </summary>
    public static string[] ReadList(IConfigurationSection section) =>
        (section.Value is { } single ? [single] : section.GetChildren().Select(child => child.Value))
            .SelectMany(value => (value ?? "").Split([';', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
}
