using System.Management.Automation;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace WdsWeb.Api.Wds;

/// <summary>
/// The account Remote mode connects to the WDS server as, from one of two kinds of file:
/// <list type="bullet">
/// <item>credential.json, written by Install-WdsWeb.ps1 -Credential: the password protected with DPAPI
/// for this machine, so the service can read it whatever account it runs as. Any process on the
/// machine could unprotect it, so the installer lets only SYSTEM and Administrators read the file.</item>
/// <item>A PSCredential saved with <c>Get-Credential | Export-Clixml</c> (*.xml), protected for the
/// account that saved it: handy for running the console by hand in development.</item>
/// </list>
/// </summary>
public static class StoredCredential
{
    /// <summary>Extra DPAPI input, so the password can't be unprotected without knowing it's ours.</summary>
    public static readonly byte[] Entropy = "WdsWeb"u8.ToArray();

    public static PSCredential Load(string path) =>
        Path.GetExtension(path).Equals(".xml", StringComparison.OrdinalIgnoreCase)
            ? CliXmlCredential.Load(path)
            : LoadMachineProtected(path);

    /// <summary>Writes credential.json, as Install-WdsWeb.ps1 does (the installer also restricts who can read it).</summary>
    public static void Save(string path, string userName, string password)
    {
        var plain = Encoding.Unicode.GetBytes(password);
        try
        {
            var file = new StoredCredentialFile(userName, Convert.ToBase64String(ProtectedData.Protect(plain, Entropy, DataProtectionScope.LocalMachine)));
            File.WriteAllText(path, JsonSerializer.Serialize(file, JsonSerializerOptions.Web));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    private static PSCredential LoadMachineProtected(string path)
    {
        var file = JsonSerializer.Deserialize<StoredCredentialFile>(File.ReadAllText(path), JsonSerializerOptions.Web);
        if (file is not { UserName.Length: > 0, Password.Length: > 0 })
            throw new InvalidDataException($"{path} is missing the user name or password.");

        var plain = ProtectedData.Unprotect(Convert.FromBase64String(file.Password), Entropy, DataProtectionScope.LocalMachine);
        try
        {
            var password = new SecureString();
            for (var i = 0; i + 1 < plain.Length; i += 2)
                password.AppendChar((char)(plain[i] | (plain[i + 1] << 8)));
            password.MakeReadOnly();
            return new PSCredential(file.UserName, password);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    /// <param name="Password">The UTF-16 password, DPAPI-protected for this machine, in base64.</param>
    private sealed record StoredCredentialFile(string UserName, string Password);
}
