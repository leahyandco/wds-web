# Enables, disables or removes a boot or install image, or removes an empty install image group.
param(
    [Parameter(Mandatory)] [ValidateSet('BootImage', 'InstallImage', 'ImageGroup')] [string] $Target,
    [Parameter(Mandatory)] [ValidateSet('Enable', 'Disable', 'Remove')] [string] $Action,
    [Parameter(Mandatory)] [string] $Name,
    [string] $Architecture,
    [string] $ImageGroup,
    [string] $FileName
)
$ErrorActionPreference = 'Stop'
Assert-WdsModule

# Name plus architecture (boot) or group (install) identifies an image; the file name tells apart
# two images that share a name.
$image = @{ ImageName = $Name }
if ($FileName) { $image.FileName = $FileName }

# The WDS cmdlets succeed quietly when nothing matches, so check the image exists first; otherwise
# a mistyped name would look like a successful change.
switch ($Target) {
    'BootImage' {
        if (-not $Architecture) { throw 'Say which architecture the boot image is for.' }
        $image.Architecture = $Architecture
        if (-not (Get-WdsBootImage @image -ErrorAction SilentlyContinue)) { throw "There's no $Architecture boot image named '$Name'." }
        switch ($Action) {
            'Enable' { Enable-WdsBootImage @image | Out-Null }
            'Disable' { Disable-WdsBootImage @image -Confirm:$false | Out-Null }
            'Remove' { Remove-WdsBootImage @image -Confirm:$false | Out-Null }
        }
    }
    'InstallImage' {
        if ($ImageGroup) { $image.ImageGroup = $ImageGroup }
        if (-not (Get-WdsInstallImage @image -ErrorAction SilentlyContinue)) { throw "There's no install image named '$Name'$(if ($ImageGroup) { " in $ImageGroup" })." }
        switch ($Action) {
            'Enable' { Enable-WdsInstallImage @image | Out-Null }
            'Disable' { Disable-WdsInstallImage @image | Out-Null }
            'Remove' { Remove-WdsInstallImage @image | Out-Null }
        }
    }
    'ImageGroup' {
        if ($Action -ne 'Remove') { throw 'Image groups can only be removed.' }
        if (-not (Get-WdsInstallImageGroup -Name $Name -ErrorAction SilentlyContinue)) { throw "There's no image group named $Name." }
        if (@(Get-WdsInstallImage -ImageGroup $Name -ErrorAction SilentlyContinue).Count -gt 0) {
            throw "Image group $Name still has images in it. Remove them first."
        }
        Remove-WdsInstallImageGroup -Name $Name | Out-Null
    }
}

ConvertTo-WdsJson ([ordered]@{ done = $true })
