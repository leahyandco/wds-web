using WdsWeb.Api.Auth;

namespace WdsWeb.Api.Tests;

public class WindowsSignInTests
{
    [Theory]
    [InlineData(@"CONTOSO\jdoe", "jdoe", "CONTOSO")]
    [InlineData("jdoe@contoso.com", "jdoe@contoso.com", null)]
    [InlineData("Administrator", "Administrator", ".")]
    public void Splits_the_domain_off_the_user_name(string userName, string user, string? domain)
    {
        Assert.Equal((user, domain), WindowsSignIn.Split(userName));
    }
}
