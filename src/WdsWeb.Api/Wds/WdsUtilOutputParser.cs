using System.Text.RegularExpressions;

namespace WdsWeb.Api.Wds;

/// <summary>A line of WDSUTIL's report, with the lines indented beneath it as children.</summary>
public sealed record WdsUtilNode(string Name, string? Value, IReadOnlyList<WdsUtilNode> Children);

/// <summary>
/// Turns the indented text WDSUTIL prints (for example <c>/Get-Server /Show:Config</c>) into a tree.
/// WDSUTIL has no machine-readable output, so this relies on its layout: upper-case banners, then
/// "Label: value" and "x64 - value" lines nested by indentation. It only understands English output.
/// Lines it doesn't recognise are kept as bare names rather than dropped.
/// </summary>
public static partial class WdsUtilOutputParser
{
    public static IReadOnlyList<WdsUtilNode> Parse(string text)
    {
        var roots = new List<Builder>();
        var parents = new Stack<(int Indent, Builder Node)>();

        foreach (var rawLine in text.Split('\n'))
        {
            var line = rawLine.TrimEnd();
            var content = line.TrimStart();
            if (content.Length == 0 || IsNoise(content)) continue;
            var indent = line.Length - content.Length;

            if (indent == 0 && IsBanner(content))
            {
                var banner = new Builder(content, null);
                roots.Add(banner);
                parents.Clear();
                parents.Push((-1, banner));
                continue;
            }

            var (name, value) = Split(content);
            var node = new Builder(name, value);
            while (parents.Count > 0 && parents.Peek().Indent >= indent) parents.Pop();
            if (parents.Count == 0) roots.Add(node);
            else parents.Peek().Node.Children.Add(node);
            parents.Push((indent, node));
        }

        return roots.Select(r => r.Build()).ToList();
    }

    private static bool IsNoise(string content) =>
        content.StartsWith("Windows Deployment Services Management Utility", StringComparison.Ordinal) ||
        content.StartsWith("Copyright", StringComparison.Ordinal) ||
        content.StartsWith("The command completed", StringComparison.Ordinal) ||
        (content.StartsWith('[') && content.EndsWith(']') && content.Contains("---", StringComparison.Ordinal));

    private static bool IsBanner(string content) =>
        !content.Contains(':') &&
        content.Any(char.IsLetter) &&
        content.All(c => !char.IsLetter(c) || char.IsUpper(c));

    private static (string Name, string? Value) Split(string content)
    {
        // Per-architecture lists: "x64uefi - boot\x64\wdsmgfw.efi", or "arm64   -" when unset.
        var listItem = ListItem().Match(content);
        if (listItem.Success) return (listItem.Groups["name"].Value, NullIfEmpty(listItem.Groups["value"].Value));

        // "Label: value". Split at the first ": " so values such as C:\RemoteInstall survive.
        var separator = content.IndexOf(": ", StringComparison.Ordinal);
        if (separator > 0) return (content[..separator].Trim(), NullIfEmpty(content[(separator + 2)..]));
        if (content.EndsWith(':')) return (content[..^1].Trim(), null);
        return (content, null);
    }

    private static string? NullIfEmpty(string value) => value.Trim() is { Length: > 0 } trimmed ? trimmed : null;

    [GeneratedRegex(@"^(?<name>[A-Za-z0-9]+)\s+-(?:\s+(?<value>.*))?$")]
    private static partial Regex ListItem();

    private sealed class Builder(string name, string? value)
    {
        public List<Builder> Children { get; } = [];

        public WdsUtilNode Build() => new(name, value, Children.Select(c => c.Build()).ToList());
    }
}
