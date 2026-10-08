using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

public class StoredCredentialTests
{
    [Fact]
    public void Round_trips_a_credential_protected_for_this_machine()
    {
        var path = Path.Combine(Path.GetTempPath(), $"wdsweb-test-{Guid.NewGuid():N}.json");
        try
        {
            StoredCredential.Save(path, @"CONTOSO\wdsadmin", "p@ss wörd");

            var credential = StoredCredential.Load(path);

            Assert.Equal(@"CONTOSO\wdsadmin", credential.UserName);
            Assert.Equal("p@ss wörd", credential.GetNetworkCredential().Password);
            Assert.DoesNotContain("p@ss", File.ReadAllText(path));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Refuses_a_file_without_a_password()
    {
        var path = Path.Combine(Path.GetTempPath(), $"wdsweb-test-{Guid.NewGuid():N}.json");
        File.WriteAllText(path, """{"userName":"CONTOSO\\wdsadmin"}""");
        try
        {
            Assert.Throws<InvalidDataException>(() => StoredCredential.Load(path));
        }
        finally
        {
            File.Delete(path);
        }
    }
}
