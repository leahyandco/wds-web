using System.Security.Cryptography;
using System.Text;
using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

public class CliXmlCredentialTests
{
    [Fact]
    public void Loads_a_credential_saved_by_Export_Clixml()
    {
        // What `Get-Credential | Export-Clixml` writes: the password DPAPI-protected, as hex.
        var protectedPassword = Convert.ToHexStringLower(
            ProtectedData.Protect(Encoding.Unicode.GetBytes("p@ss wörd"), null, DataProtectionScope.CurrentUser));
        var path = Path.GetTempFileName();
        File.WriteAllText(path, $"""
            <Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">
              <Obj RefId="0">
                <TN RefId="0">
                  <T>System.Management.Automation.PSCredential</T>
                  <T>System.Object</T>
                </TN>
                <ToString>System.Management.Automation.PSCredential</ToString>
                <Props>
                  <S N="UserName">WDS01\wdsadmin</S>
                  <SS N="Password">{protectedPassword}</SS>
                </Props>
              </Obj>
            </Objs>
            """);

        try
        {
            var credential = CliXmlCredential.Load(path);

            Assert.Equal(@"WDS01\wdsadmin", credential.UserName);
            Assert.Equal("p@ss wörd", credential.GetNetworkCredential().Password);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Rejects_files_that_are_not_credentials()
    {
        var path = Path.GetTempFileName();
        File.WriteAllText(path, """<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S>hello</S></Objs>""");

        try
        {
            Assert.Throws<InvalidDataException>(() => CliXmlCredential.Load(path));
        }
        finally
        {
            File.Delete(path);
        }
    }
}
