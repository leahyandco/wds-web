using System.Collections.Concurrent;

namespace WdsWeb.Api.Wds;

/// <summary>
/// The PowerShell scripts in Wds/Scripts, embedded in the assembly. Each takes its inputs through a
/// param() block and prints a single JSON string.
/// </summary>
public static class WdsScripts
{
    private static readonly ConcurrentDictionary<string, string> Loaded = new();

    /// <summary>Runs once per session: imports the WDS module and defines the shared helpers.</summary>
    public static string Init => Get("Init");

    public static string Get(string name) => Loaded.GetOrAdd(name, static key =>
    {
        using var stream = typeof(WdsScripts).Assembly.GetManifestResourceStream($"WdsWeb.Scripts.{key}.ps1")
            ?? throw new InvalidOperationException($"There's no embedded script named {key}.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    });
}
