using System.Collections.Concurrent;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
using Microsoft.Extensions.Options;

namespace WdsWeb.Api.Wds;

/// <summary>
/// Keeps a few PowerShell sessions open on the WDS server. The WDS module only loads in Windows
/// PowerShell 5.1, so Local mode starts powershell.exe out of process and Remote mode opens WinRM
/// sessions to the server's default endpoint, which is 5.1. Either way the scripts run on the WDS
/// server itself, next to WDSUTIL, the registry and the event logs they read.
/// </summary>
public sealed class WdsSessionPool : IDisposable
{
    private const string WindowsPowerShellShellUri = "http://schemas.microsoft.com/powershell/Microsoft.PowerShell";

    private readonly WdsOptions _options;
    private readonly ILogger<WdsSessionPool> _logger;
    private readonly SemaphoreSlim _slots;
    private readonly ConcurrentBag<Runspace> _idle = [];
    private readonly Lazy<PSCredential?> _credential;
    private volatile bool _disposed;

    public WdsSessionPool(IOptions<WdsOptions> options, ILogger<WdsSessionPool> logger)
    {
        _options = options.Value;
        _logger = logger;
        if (_options.Mode == WdsConnectionMode.Remote && string.IsNullOrWhiteSpace(_options.ComputerName))
            throw new InvalidOperationException("Wds:ComputerName is required when Wds:Mode is Remote.");

        _slots = new SemaphoreSlim(Math.Max(1, _options.PoolSize));
        // PublicationOnly so a missing credential file isn't cached as a permanent failure.
        _credential = new Lazy<PSCredential?>(LoadCredential, LazyThreadSafetyMode.PublicationOnly);
    }

    public WdsConnectionMode Mode => _options.Mode;

    public string TargetName => _options.Mode == WdsConnectionMode.Remote ? _options.ComputerName! : Environment.MachineName;

    public async Task<Lease> AcquireAsync(CancellationToken ct)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _slots.WaitAsync(ct);
        try
        {
            while (_idle.TryTake(out var idle))
            {
                if (IsUsable(idle)) return new Lease(this, idle);
                idle.Dispose();
            }
            return new Lease(this, await OpenAsync(ct));
        }
        catch
        {
            _slots.Release();
            throw;
        }
    }

    public void Dispose()
    {
        _disposed = true;
        while (_idle.TryTake(out var runspace)) runspace.Dispose();
    }

    private async Task<Runspace> OpenAsync(CancellationToken ct)
    {
        Runspace? runspace = null;
        try
        {
            runspace = CreateRunspace();
            await Task.Run(runspace.Open, ct);
            using var ps = PowerShell.Create();
            ps.Runspace = runspace;
            ps.AddScript(WdsScripts.Init, useLocalScope: true);
            await ps.InvokeAsync();
            _logger.LogInformation("Opened a {Mode} PowerShell session on {Target}", _options.Mode, TargetName);
            return runspace;
        }
        catch (Exception ex) when (ex is not OperationCanceledException and not WdsConnectionException)
        {
            runspace?.Dispose();
            throw new WdsConnectionException($"Couldn't open a PowerShell session on {TargetName}: {ex.Message}", ex);
        }
        catch
        {
            runspace?.Dispose();
            throw;
        }
    }

    private Runspace CreateRunspace()
    {
        if (_options.Mode == WdsConnectionMode.Local)
        {
            // Asking for 5.1 makes PowerShellProcessInstance start Windows PowerShell rather than pwsh.
            var process = new PowerShellProcessInstance(new Version(5, 1), null, null, false);
            return RunspaceFactory.CreateOutOfProcessRunspace(TypeTable.LoadDefaultTypeFiles(), process);
        }

        var port = _options.Port ?? (_options.UseSsl ? 5986 : 5985);
        var connection = new WSManConnectionInfo(
            _options.UseSsl, _options.ComputerName, port, "/wsman", WindowsPowerShellShellUri, _credential.Value)
        {
            AuthenticationMechanism = AuthenticationMechanism.Negotiate,
            OpenTimeout = (int)TimeSpan.FromSeconds(30).TotalMilliseconds,
        };
        return RunspaceFactory.CreateRunspace(connection);
    }

    private PSCredential? LoadCredential()
    {
        if (string.IsNullOrWhiteSpace(_options.CredentialFile)) return null;

        var path = Environment.ExpandEnvironmentVariables(_options.CredentialFile);
        if (!File.Exists(path))
            throw new WdsConnectionException(
                $"The credential file {path} doesn't exist. Create it with: Get-Credential | Export-Clixml \"{path}\"");
        return CliXmlCredential.Load(path);
    }

    private static bool IsUsable(Runspace runspace) =>
        runspace.RunspaceStateInfo.State == RunspaceState.Opened &&
        runspace.RunspaceAvailability == RunspaceAvailability.Available;

    private void Return(Runspace runspace, bool reuse)
    {
        if (reuse && !_disposed && IsUsable(runspace)) _idle.Add(runspace);
        else runspace.Dispose();
        _slots.Release();
    }

    /// <summary>Exclusive use of one session until disposed.</summary>
    public sealed class Lease : IDisposable
    {
        private readonly WdsSessionPool _pool;
        private bool _discard;
        private bool _returned;

        internal Lease(WdsSessionPool pool, Runspace runspace)
        {
            _pool = pool;
            Runspace = runspace;
        }

        public Runspace Runspace { get; }

        /// <summary>Close the session instead of reusing it, e.g. after it broke or was stopped mid-command.</summary>
        public void Discard() => _discard = true;

        public void Dispose()
        {
            if (_returned) return;
            _returned = true;
            _pool.Return(Runspace, !_discard);
        }
    }
}
