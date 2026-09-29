# Recent WDS events, newest first: the Deployment-Services-Diagnostics channels and the WDSServer
# service's entries in the Application log. Most of the Operational channel is routine housekeeping,
# including a record of every management call (this console's own among them), so that is left out
# unless -IncludeRoutine is given.
param([int] $Hours = 72, [int] $MaxEvents = 300, [switch] $IncludeRoutine)
$ErrorActionPreference = 'Stop'

# 57348/57349 TFTP read buffer created/deleted, 57350/57351 TFTP endpoint opened/closed,
# 57352-57354 WDS PowerShell module (WdsCim) call started/succeeded/failed, 53248/53249 WDSUTIL run/succeeded.
$routineIds = 57348, 57349, 57350, 57351, 57352, 57353, 57354, 53248, 53249

$since = (Get-Date).AddHours(-$Hours)
$queries = @(
    @{ LogName = 'Microsoft-Windows-Deployment-Services-Diagnostics/Admin'; StartTime = $since }
    @{ LogName = 'Microsoft-Windows-Deployment-Services-Diagnostics/Operational'; StartTime = $since }
    @{ LogName = 'Application'; ProviderName = 'WDSServer'; StartTime = $since }
)

$warnings = @()
$events = foreach ($query in $queries) {
    try {
        # Fetch generously: routine events can outnumber the rest fifty to one.
        Get-WinEvent -FilterHashtable $query -MaxEvents 5000
    } catch {
        # No matching events, or a log or provider this server doesn't have: nothing to show, not a failure.
        if ($_.FullyQualifiedErrorId -notlike 'NoMatching*') { $warnings += "$($query.LogName): $($_.Exception.Message)" }
    }
}

$routine = @($events | Where-Object { $routineIds -contains $_.Id })
$shown = if ($IncludeRoutine) { @($events) } else { @($events | Where-Object { $routineIds -notcontains $_.Id }) }

$items = @($shown | Sort-Object -Property TimeCreated -Descending | Select-Object -First $MaxEvents | ForEach-Object {
    [ordered]@{
        time      = $_.TimeCreated.ToUniversalTime().ToString('o')
        id        = $_.Id
        level     = [int]$_.Level
        levelName = $_.LevelDisplayName
        log       = $_.LogName
        provider  = $_.ProviderName
        recordId  = $_.RecordId
        message   = $_.Message
        data      = Get-WdsEventData $_
    }
})

ConvertTo-WdsJson ([ordered]@{
    events        = $items
    routineHidden = if ($IncludeRoutine) { 0 } else { $routine.Count }
    warnings      = $warnings
})
