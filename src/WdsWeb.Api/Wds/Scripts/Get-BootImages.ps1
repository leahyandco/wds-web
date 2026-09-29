# Boot images registered with WDS, with every property the WDS module reports.
$ErrorActionPreference = 'Stop'
Assert-WdsModule

ConvertTo-WdsJson @(Get-WdsBootImage | ForEach-Object { ConvertTo-WdsObject $_ })
