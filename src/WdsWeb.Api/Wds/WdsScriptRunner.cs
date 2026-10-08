using System.Management.Automation;
using System.Management.Automation.Remoting;
using System.Management.Automation.Runspaces;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace WdsWeb.Api.Wds;

/// <summary>
/// Runs one of the embedded scripts on the WDS server and returns the JSON it printed. Inputs go
/// through AddParameter, so they're bound to the script's param() block, never spliced into its text.
/// </summary>
public sealed class WdsScriptRunner(WdsSessionPool pool, IOptions<WdsOptions> options, ILogger<WdsScriptRunner> logger)
{
    /// <param name="retryOnBrokenSession">
    /// Retry once on a new session if the pooled one had died (idle timeout, server reboot), or if the
    /// WDS module's RPC call failed (its WMI provider host crashed, and Windows restarts it on the next
    /// call). Only safe for scripts that don't change anything.
    /// </param>
    /// <param name="timeout">How long to allow; defaults to <see cref="WdsOptions.CommandTimeout"/>.</param>
    public async Task<JsonElement> RunAsync(
        string scriptName,
        IReadOnlyDictionary<string, object?>? parameters = null,
        bool retryOnBrokenSession = true,
        TimeSpan? timeout = null,
        CancellationToken ct = default)
    {
        var script = WdsScripts.Get(scriptName);
        var limit = timeout ?? options.Value.CommandTimeout;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(limit);

        for (var attempt = 1; ; attempt++)
        {
            using var lease = await pool.AcquireAsync(deadline.Token);
            try
            {
                return await InvokeAsync(lease.Runspace, scriptName, script, parameters, deadline.Token);
            }
            catch (Exception ex) when (IsBrokenSession(ex))
            {
                lease.Discard();
                if (!retryOnBrokenSession || attempt > 1)
                    throw new WdsConnectionException($"Lost the PowerShell session on {pool.TargetName}: {ex.Message}", ex);
                logger.LogInformation("The session on {Target} had closed; retrying {Script} on a new one", pool.TargetName, scriptName);
            }
            catch (WdsScriptException ex) when (retryOnBrokenSession && attempt == 1 && IsFailedRpc(ex))
            {
                logger.LogInformation("{Script} on {Target} hit a failed RPC call ({Error}); retrying it once", scriptName, pool.TargetName, ex.Message);
            }
            catch (OperationCanceledException)
            {
                // A stopped command can leave the session in an odd state, so don't hand it out again.
                lease.Discard();
                if (!ct.IsCancellationRequested)
                    throw new TimeoutException($"{scriptName} didn't finish within {limit}.");
                throw;
            }
        }
    }

    /// <summary>
    /// Runs WDSUTIL commands that the caller built and validated, in order, stopping at the first that
    /// fails. Never retried: an earlier command may already have changed the server.
    /// </summary>
    public Task<JsonElement> RunWdsUtilAsync(IReadOnlyList<string[]> commands, CancellationToken ct = default)
    {
        if (commands.Count == 0) throw new InvalidRequestException("There's nothing to change.");
        return RunAsync("Invoke-WdsUtilCommands", new Dictionary<string, object?>
        {
            ["Commands"] = commands.Cast<object>().ToArray(),
        }, retryOnBrokenSession: false, ct: ct);
    }

    /// <summary>
    /// Runs a long script, such as an import, on a session of its own, reporting its information,
    /// warning and progress records as they arrive. Never retried, since a job may already have
    /// changed the server when its session breaks.
    /// </summary>
    public async Task<JsonElement> RunJobAsync(
        string scriptName,
        IReadOnlyDictionary<string, object?> parameters,
        Action<string> onMessage,
        Action<ProgressRecord> onProgress,
        CancellationToken ct)
    {
        var limit = options.Value.JobTimeout;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(limit);

        using var runspace = await pool.OpenDedicatedAsync(deadline.Token);
        try
        {
            return await InvokeAsync(runspace, scriptName, WdsScripts.Get(scriptName), parameters, deadline.Token, ps =>
            {
                ps.Streams.Information.DataAdded += (_, e) => onMessage(ps.Streams.Information[e.Index].MessageData?.ToString() ?? "");
                ps.Streams.Warning.DataAdded += (_, e) => onMessage("Warning: " + ps.Streams.Warning[e.Index].Message);
                ps.Streams.Progress.DataAdded += (_, e) => onProgress(ps.Streams.Progress[e.Index]);
            });
        }
        catch (Exception ex) when (IsBrokenSession(ex))
        {
            throw new WdsConnectionException($"Lost the PowerShell session on {pool.TargetName} during {scriptName}: {ex.Message}", ex);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new TimeoutException($"{scriptName} didn't finish within {limit}.");
        }
    }

    private async Task<JsonElement> InvokeAsync(
        Runspace runspace,
        string scriptName,
        string script,
        IReadOnlyDictionary<string, object?>? parameters,
        CancellationToken ct,
        Action<PowerShell>? attach = null)
    {
        using var ps = PowerShell.Create();
        ps.Runspace = runspace;
        ps.AddScript(script, useLocalScope: true);
        if (parameters is not null)
        {
            foreach (var (name, value) in parameters) ps.AddParameter(name, value);
        }
        attach?.Invoke(ps);

        PSDataCollection<PSObject> output;
        using (ct.Register(() => ps.BeginStop(null, null)))
        {
            try
            {
                output = await ps.InvokeAsync();
            }
            catch (RuntimeException) when (ct.IsCancellationRequested)
            {
                // Stopping a pipeline surfaces in several shapes ("The pipeline has been stopped"); whatever
                // the shape, a command that failed after being cancelled was cancelled.
                throw new OperationCanceledException(ct);
            }
            catch (RuntimeException ex) when (!IsBrokenSession(ex))
            {
                throw new WdsScriptException(scriptName, ex.ErrorRecord?.Exception?.Message ?? ex.Message, ex);
            }
        }

        foreach (var error in ps.Streams.Error)
            logger.LogWarning("{Script} on {Target}: {Error}", scriptName, pool.TargetName, error);

        if (output.Count == 0 || output[^1]?.BaseObject is not string json)
            throw new WdsScriptException(scriptName, "The script finished without returning any data.");

        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static bool IsBrokenSession(Exception ex) =>
        ex is PSRemotingTransportException or PSRemotingDataStructureException or InvalidRunspaceStateException;

    // RPC_S_CALL_FAILED (0x800706BE) or RPC_S_SERVER_UNAVAILABLE (0x800706BA) from the WDS module's CIM
    // provider; the exception arrives serialized from the WDS server, so match its message or code.
    private static bool IsFailedRpc(WdsScriptException ex) =>
        ex.Message.Contains("remote procedure call", StringComparison.OrdinalIgnoreCase) ||
        ex.Message.Contains("RPC server", StringComparison.OrdinalIgnoreCase) ||
        ex.Message.Contains("0x800706BE", StringComparison.OrdinalIgnoreCase) ||
        ex.Message.Contains("0x800706BA", StringComparison.OrdinalIgnoreCase);
}
