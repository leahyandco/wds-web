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
    /// Retry once on a new session if the pooled one had died (idle timeout, server reboot). Only
    /// safe for scripts that don't change anything.
    /// </param>
    public async Task<JsonElement> RunAsync(
        string scriptName,
        IReadOnlyDictionary<string, object?>? parameters = null,
        bool retryOnBrokenSession = true,
        CancellationToken ct = default)
    {
        var script = WdsScripts.Get(scriptName);
        var commandTimeout = options.Value.CommandTimeout;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(commandTimeout);

        for (var attempt = 1; ; attempt++)
        {
            using var lease = await pool.AcquireAsync(timeout.Token);
            try
            {
                return await InvokeAsync(lease.Runspace, scriptName, script, parameters, timeout.Token);
            }
            catch (Exception ex) when (IsBrokenSession(ex))
            {
                lease.Discard();
                if (!retryOnBrokenSession || attempt > 1)
                    throw new WdsConnectionException($"Lost the PowerShell session on {pool.TargetName}: {ex.Message}", ex);
                logger.LogInformation("The session on {Target} had closed; retrying {Script} on a new one", pool.TargetName, scriptName);
            }
            catch (OperationCanceledException)
            {
                // A stopped command can leave the session in an odd state, so don't hand it out again.
                lease.Discard();
                if (!ct.IsCancellationRequested)
                    throw new TimeoutException($"{scriptName} didn't finish within {commandTimeout}.");
                throw;
            }
        }
    }

    private async Task<JsonElement> InvokeAsync(
        Runspace runspace,
        string scriptName,
        string script,
        IReadOnlyDictionary<string, object?>? parameters,
        CancellationToken ct)
    {
        using var ps = PowerShell.Create();
        ps.Runspace = runspace;
        ps.AddScript(script, useLocalScope: true);
        if (parameters is not null)
        {
            foreach (var (name, value) in parameters) ps.AddParameter(name, value);
        }

        PSDataCollection<PSObject> output;
        using (ct.Register(() => ps.BeginStop(null, null)))
        {
            try
            {
                output = await ps.InvokeAsync();
            }
            catch (PipelineStoppedException) when (ct.IsCancellationRequested)
            {
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
}
