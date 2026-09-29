# Recent WDS events, newest first: the Deployment-Services-Diagnostics channels plus the WDSServer
# service's own entries in the System and Application logs.
param([int] $Hours = 72, [int] $MaxEvents = 300)
$ErrorActionPreference = 'Stop'

$since = (Get-Date).AddHours(-$Hours)
$queries = @(
    @{ LogName = 'Microsoft-Windows-Deployment-Services-Diagnostics/Admin'; StartTime = $since }
    @{ LogName = 'Microsoft-Windows-Deployment-Services-Diagnostics/Operational'; StartTime = $since }
    @{ LogName = 'System'; ProviderName = 'WDSServer'; StartTime = $since }
    @{ LogName = 'Application'; ProviderName = 'WDSServer'; StartTime = $since }
)

$warnings = @()
$events = foreach ($query in $queries) {
    try {
        Get-WinEvent -FilterHashtable $query -MaxEvents $MaxEvents
    } catch {
        # No matching events, or a log or provider this server doesn't have: nothing to show, not a failure.
        if ($_.FullyQualifiedErrorId -notlike 'NoMatching*') { $warnings += "$($query.LogName): $($_.Exception.Message)" }
    }
}

$items = @($events | Sort-Object -Property TimeCreated -Descending | Select-Object -First $MaxEvents | ForEach-Object {
    [ordered]@{
        time      = $_.TimeCreated.ToUniversalTime().ToString('o')
        id        = $_.Id
        level     = [int]$_.Level
        levelName = $_.LevelDisplayName
        log       = $_.LogName
        provider  = $_.ProviderName
        recordId  = $_.RecordId
        message   = $_.Message
    }
})

ConvertTo-WdsJson ([ordered]@{ events = $items; warnings = $warnings })
