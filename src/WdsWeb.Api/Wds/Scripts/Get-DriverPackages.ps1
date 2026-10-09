# The WDS driver store, as WDSUTIL reports it: every package, then each driver group with its
# packages and filters. (The WDS module's Get-WdsDriverPackage returns only some packages, and the
# CIM class behind it none.) The web service parses both reports.
$ErrorActionPreference = 'Stop'

$packages = Invoke-WdsUtil -Arguments '/Get-AllDriverPackages'
if ($packages.ExitCode -ne 0) { throw "wdsutil /Get-AllDriverPackages failed: $($packages.Output)" }
$groups = Invoke-WdsUtil -Arguments '/Get-AllDriverGroups', '/Show:All'
if ($groups.ExitCode -ne 0) { throw "wdsutil /Get-AllDriverGroups failed: $($groups.Output)" }

ConvertTo-WdsJson ([ordered]@{ packages = $packages.Output; groups = $groups.Output })
