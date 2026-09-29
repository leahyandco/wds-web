# Driver packages in the WDS driver store, with the drivers each contains.
$ErrorActionPreference = 'Stop'
Assert-WdsModule

ConvertTo-WdsJson @(Get-WdsDriverPackage | ForEach-Object { ConvertTo-WdsObject $_ })
