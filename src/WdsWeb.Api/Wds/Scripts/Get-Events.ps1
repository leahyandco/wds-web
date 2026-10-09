# Recent WDS events, newest first: the Deployment-Services-Diagnostics channels and the WDS services'
# entries in the Application log. Most of the Operational channel is routine housekeeping, including a
# record of every management call (this console's own among them), so that is left out unless
# -IncludeRoutine is given. -ProblemsOnly keeps critical events, errors and warnings. Only the newest
# -MaxEvents are returned; total says how many matched.
param([int] $Hours = 72, [int] $MaxEvents = 300, [switch] $IncludeRoutine, [switch] $ProblemsOnly)
$ErrorActionPreference = 'Stop'

# 57348/57349 TFTP read buffer created/deleted, 57350/57351 TFTP endpoint opened/closed,
# 57352-57354 WDS PowerShell module (WdsCim) call started/succeeded/failed, 53248/53249 WDSUTIL run/succeeded,
# 1305 BINLSVC wrote a client's boot configuration (once per boot menu).
$routineIds = 57348, 57349, 57350, 57351, 57352, 57353, 57354, 53248, 53249, 1305

# The WDS services each log to the Application log under their own source. Several aren't in
# Get-WinEvent's provider list (asking for WDSIMGSRV by name fails), so they're matched with XPath.
$sources = 'WDSServer', 'WDSIMGSRV', 'WDSPXE', 'WDSTFTP', 'WDSMC', 'WDSDDPS', 'BINLSVC'
$providers = ($sources | ForEach-Object { "@Name='$_'" }) -join ' or '
$since = (Get-Date).AddHours(-$Hours)
$queries = @(
    @{ FilterHashtable = @{ LogName = 'Microsoft-Windows-Deployment-Services-Diagnostics/Admin'; StartTime = $since } }
    @{ FilterHashtable = @{ LogName = 'Microsoft-Windows-Deployment-Services-Diagnostics/Operational'; StartTime = $since } }
    @{ LogName = 'Application'; FilterXPath = "*[System[Provider[$providers] and TimeCreated[timediff(@SystemTime) <= $([long]$Hours * 3600000)]]]" }
)

$warnings = @()
$events = foreach ($query in $queries) {
    try {
        # Fetch generously: routine events can outnumber the rest fifty to one.
        Get-WinEvent @query -MaxEvents 5000
    } catch {
        # No matching events, or a log or provider this server doesn't have: nothing to show, not a failure.
        $name = if ($query.LogName) { $query.LogName } else { $query.FilterHashtable.LogName }
        if ($_.FullyQualifiedErrorId -notlike 'NoMatching*') { $warnings += "${name}: $($_.Exception.Message)" }
    }
}

$routine = @($events | Where-Object { $routineIds -contains $_.Id })
$shown = if ($IncludeRoutine) { @($events) } else { @($events | Where-Object { $routineIds -notcontains $_.Id }) }
# Levels 1-3: critical, error, warning.
if ($ProblemsOnly) { $shown = @($shown | Where-Object { $_.Level -ge 1 -and $_.Level -le 3 }) }

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
    total         = $shown.Count
    routineHidden = if ($IncludeRoutine) { 0 } else { $routine.Count }
    warnings      = $warnings
})
