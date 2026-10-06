# An install image's unattend file, if it has one: what Windows Setup is told when it installs the image.
param(
    [Parameter(Mandatory)] [string] $Name,
    [string] $ImageGroup,
    [string] $FileName
)
$ErrorActionPreference = 'Stop'
Assert-WdsModule

$image = @{ ImageName = $Name }
if ($ImageGroup) { $image.ImageGroup = $ImageGroup }
if ($FileName) { $image.FileName = $FileName }
$found = @(Get-WdsInstallImage @image -ErrorAction SilentlyContinue)
if ($found.Count -eq 0) { throw "There's no install image named '$Name'$(if ($ImageGroup) { " in $ImageGroup" })." }

$path = Get-WdsImageUnattendPath $found[0]
$present = Test-Path -LiteralPath $path
ConvertTo-WdsJson ([ordered]@{
    present = $present
    path    = $path
    # ReadAllText honours a byte order mark and otherwise reads UTF-8, as Setup does.
    content = if ($present) { [IO.File]::ReadAllText($path) } else { $null }
})
