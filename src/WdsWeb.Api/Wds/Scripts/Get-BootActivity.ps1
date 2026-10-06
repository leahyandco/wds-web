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

# Later in a boot, Windows Setup asks WDS's image server for the WDS client unattend file. Since the
# April 2026 update (CVE-2026-0386) WDS refuses unless hands-free deployment is allowed again, and logs
# 270 in the Application log with the client's IP as its only value. WDSIMGSRV isn't in Get-WinEvent's
# provider list, so it's matched with XPath.
$blocked = @()
try {
    $xpath = "*[System[Provider[@Name='WDSIMGSRV'] and EventID=270 and TimeCreated[timediff(@SystemTime) <= $([long]$Hours * 3600000)]]]"
    $blocked = @(Get-WinEvent -LogName Application -FilterXPath $xpath -MaxEvents 1000)
} catch {
    if ($_.FullyQualifiedErrorId -notlike 'NoMatching*') { throw }
}

$oldest = Get-WinEvent -LogName $logName -MaxEvents 1 -Oldest -ErrorAction SilentlyContinue
$log = Get-WinEvent -ListLog $logName

ConvertTo-WdsJson ([ordered]@{
    logStartsAt = if ($oldest) { $oldest.TimeCreated.ToUniversalTime().ToString('o') } else { $null }
    logMaxBytes = $log.MaximumSizeInBytes
    events      = @(
        $records | ForEach-Object {
            [ordered]@{ time = $_.TimeCreated.ToUniversalTime().ToString('o'); id = $_.Id; data = Get-WdsEventData $_ }
        }
        $blocked | ForEach-Object {
            [ordered]@{ time = $_.TimeCreated.ToUniversalTime().ToString('o'); id = $_.Id; data = [ordered]@{ ClientIP = "$($_.Properties[0].Value)" } }
        }
    )
})
