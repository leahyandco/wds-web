using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using WdsWeb.Api.Auth;

namespace WdsWeb.Api.Tests;

public class AuthOptionsTests
{
    [Fact]
    public void Lists_can_be_json_arrays()
    {
        var section = Section(new()
        {
            ["Auth:AllowedGroups:0"] = @"CONTOSO\WDS Admins",
            ["Auth:AllowedGroups:1"] = @"BUILTIN\Administrators",
        }, "Auth:AllowedGroups");

        Assert.Equal([@"CONTOSO\WDS Admins", @"BUILTIN\Administrators"], AuthOptions.ReadList(section));
    }

    [Fact]
    public void Lists_can_be_one_string_as_in_an_environment_variable()
    {
        var section = Section(new() { ["Auth:AllowedUsers"] = @" CONTOSO\jdoe; jdoe@contoso.com ,contoso\JDOE;; " }, "Auth:AllowedUsers");

        Assert.Equal([@"CONTOSO\jdoe", "jdoe@contoso.com"], AuthOptions.ReadList(section));
    }

    [Fact]
    public void A_missing_list_is_empty()
    {
        Assert.Empty(AuthOptions.ReadList(Section([], "Auth:AllowedGroups")));
    }

    [Fact]
    public void With_nothing_configured_the_local_administrators_may_sign_in()
    {
        Assert.Equal([(@"BUILTIN\Administrators", "group")], WindowsSignIn.Configured(new AuthOptions()));
    }

    [Fact]
    public void Configured_users_replace_the_default_group()
    {
        var configured = WindowsSignIn.Configured(new AuthOptions { AllowedUsers = [@"CONTOSO\jdoe"] });

        Assert.Equal([(@"CONTOSO\jdoe", "user")], configured);
    }

    [Fact]
    public void Names_windows_cannot_find_are_reported_and_let_nobody_in()
    {
        var missing = $@"{Environment.MachineName}\wdsweb-no-such-group";
        var signIn = new WindowsSignIn(
            Options.Create(new AuthOptions { AllowedGroups = [@"BUILTIN\Administrators", missing] }),
            NullLogger<WindowsSignIn>.Instance);

        Assert.Collection(signIn.Allowed,
            administrators => Assert.True(administrators.Resolved),
            unknown =>
            {
                Assert.Equal(missing, unknown.Name);
                Assert.False(unknown.Resolved);
            });
    }

    private static IConfigurationSection Section(Dictionary<string, string?> values, string key) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build().GetSection(key);
}
