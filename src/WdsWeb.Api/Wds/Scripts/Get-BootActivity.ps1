# PXE boots (4096) and TFTP downloads started, completed and failed (4099/4100/4101), with their
# named fields. The web service pieces these into per-client boot sessions. Also reports how far back
# the Operational log reaches, since it is small and circular.
param([int] $Hours = 72)
$ErrorActionPreference = 'Stop'

$logName = 'Microsoft-Windows-Deployment-Services-Diagnostics/Operational'
$filter = @{ LogName = $logName; Id = 4096, 4099, 4100, 4101; StartTime = (Get-Date).AddHours(-$Hours) }

$records = @()
try {
    $records = @(Get-WinEvent -FilterHashtable $filter -MaxEvents 20000)
} catch {
    if ($_.FullyQualifiedErrorId -notlike 'NoMatching*') { throw }
}

$oldest = Get-WinEvent -LogName $logName -MaxEvents 1 -Oldest -ErrorAction SilentlyContinue
$log = Get-WinEvent -ListLog $logName

ConvertTo-WdsJson ([ordered]@{
    logStartsAt = if ($oldest) { $oldest.TimeCreated.ToUniversalTime().ToString('o') } else { $null }
    logMaxBytes = $log.MaximumSizeInBytes
    events      = @($records | ForEach-Object {
        [ordered]@{ time = $_.TimeCreated.ToUniversalTime().ToString('o'); id = $_.Id; data = Get-WdsEventData $_ }
    })
})
