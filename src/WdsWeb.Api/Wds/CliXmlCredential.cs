using System.Management.Automation;
using System.Security;
using System.Security.Cryptography;
using System.Xml.Linq;

namespace WdsWeb.Api.Wds;

/// <summary>
/// Reads a credential written by <c>Get-Credential | Export-Clixml</c>. The password in that file is
/// DPAPI-protected for the Windows account that wrote it, so only that account on that machine can
/// load it.
/// </summary>
public static class CliXmlCredential
{
    private static readonly XNamespace Ns = "http://schemas.microsoft.com/powershell/2004/04";

    public static PSCredential Load(string path)
    {
        var props = XDocument.Load(path).Descendants(Ns + "Props").FirstOrDefault()
            ?? throw new InvalidDataException($"{path} isn't an exported PSCredential.");
        var userName = Property(props, "S", "UserName");
        var protectedPassword = Property(props, "SS", "Password");
        if (string.IsNullOrEmpty(userName) || string.IsNullOrEmpty(protectedPassword))
            throw new InvalidDataException($"{path} is missing the user name or password.");

        // ConvertFrom-SecureString stores the UTF-16 password bytes, DPAPI-protected, as hex.
        var plain = ProtectedData.Unprotect(Convert.FromHexString(protectedPassword), null, DataProtectionScope.CurrentUser);
        try
        {
            var password = new SecureString();
            for (var i = 0; i + 1 < plain.Length; i += 2)
                password.AppendChar((char)(plain[i] | (plain[i + 1] << 8)));
            password.MakeReadOnly();
            return new PSCredential(userName, password);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    private static string? Property(XElement props, string element, string name) =>
        props.Elements(Ns + element).FirstOrDefault(e => (string?)e.Attribute("N") == name)?.Value;
}
