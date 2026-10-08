# PXE boots (4096), TFTP downloads started, completed and failed (4099/4100/4101), and, with WDS client
# logging on, the WDS client's own events (4102-4132 here, 4113/4114 in the Admin log), with their
# named fields. The web service pieces these into per-client boot sessions. Also reports how far back
# the Operational log reaches, since it is small and circular.
param([int] $Hours = 72)
$ErrorActionPreference = 'Stop'

$logName = 'Microsoft-Windows-Deployment-Services-Diagnostics/Operational'
$within = "TimeCreated[timediff(@SystemTime) <= $([long]$Hours * 3600000)]"

$records = @()
foreach ($query in @(
    @{ LogName = $logName; FilterXPath = "*[System[EventID >= 4096 and EventID <= 4132 and $within]]" }
    @{ LogName = 'Microsoft-Windows-Deployment-Services-Diagnostics/Admin'; FilterXPath = "*[System[(EventID = 4113 or EventID = 4114) and $within]]" }
)) {
    try {
        $records += @(Get-WinEvent @query -MaxEvents 20000)
    } catch {
        if ($_.FullyQualifiedErrorId -notlike 'NoMatching*') { throw }
    }
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
