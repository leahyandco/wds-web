namespace WdsWeb.Api.Wds;

/// <summary>A script ran on the WDS server and failed. The message is the server's own error.</summary>
public sealed class WdsScriptException(string scriptName, string message, Exception? innerException = null)
    : Exception(message, innerException)
{
    public string ScriptName { get; } = scriptName;
}

/// <summary>There's no usable PowerShell session on the WDS server: unreachable, refused, or not configured.</summary>
public sealed class WdsConnectionException(string message, Exception? innerException = null)
    : Exception(message, innerException);

/// <summary>The request can't be carried out as asked; the message says why, for the person who asked.</summary>
public sealed class InvalidRequestException(string message) : Exception(message);
