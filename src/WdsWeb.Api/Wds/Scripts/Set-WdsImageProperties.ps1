# Renames a boot or install image, or changes its description or display order, or an install image's
# unattend file. The web service checks the values; this checks the image exists, since the WDS
# cmdlets succeed quietly when nothing matches.
param(
    [Parameter(Mandatory)] [ValidateSet('BootImage', 'InstallImage')] [string] $Target,
    [Parameter(Mandatory)] [string] $Name,
    [string] $Architecture,
    [string] $ImageGroup,
    [string] $FileName,
    [string] $NewName,
    [string] $NewDescription,
    [long] $DisplayOrder = -1,
    [string] $UnattendXml,
    [switch] $RemoveUnattend
)
$ErrorActionPreference = 'Stop'
Assert-WdsModule

$image = @{ ImageName = $Name }
if ($FileName) { $image.FileName = $FileName }
$changes = @{}
if ($NewName) { $changes.NewImageName = $NewName }
if ($NewDescription) { $changes.NewDescription = $NewDescription }
if ($DisplayOrder -ge 0) { $changes.DisplayOrder = [uint32]$DisplayOrder }

if ($Target -eq 'BootImage') {
    if (-not $Architecture) { throw 'Say which architecture the boot image is for.' }
    $image.Architecture = $Architecture
    if (-not (Get-WdsBootImage @image -ErrorAction SilentlyContinue)) { throw "There's no $Architecture boot image named '$Name'." }
    if ($changes.Count) { Set-WdsBootImage @image @changes | Out-Null }
} else {
    if ($ImageGroup) { $image.ImageGroup = $ImageGroup }
    $found = @(Get-WdsInstallImage @image -ErrorAction SilentlyContinue)
    if ($found.Count -eq 0) { throw "There's no install image named '$Name'$(if ($ImageGroup) { " in $ImageGroup" })." }
    if ($found.Count -gt 1) { throw "More than one install image is named '$Name'; say which file." }

    # WDS has no command to drop an unattend file; the MMC deletes it, so do the same.
    if ($RemoveUnattend) {
        $path = Get-WdsImageUnattendPath $found[0]
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
    }
    # WDS copies the unattend file in beside the image, so it only needs to exist for the call.
    $temporary = $null
    try {
        if ($UnattendXml) {
            $temporary = Join-Path $env:TEMP "wdsweb-unattend-$([guid]::NewGuid().ToString('N')).xml"
            [IO.File]::WriteAllText($temporary, $UnattendXml, (New-Object System.Text.UTF8Encoding $false))
            $changes.UnattendFile = $temporary
            $changes.OverwriteUnattend = $true
        }
        if ($changes.Count) { Set-WdsInstallImage @image @changes | Out-Null }
    } finally {
        if ($temporary -and (Test-Path -LiteralPath $temporary)) { Remove-Item -LiteralPath $temporary }
    }
}

ConvertTo-WdsJson ([ordered]@{ done = $true })
