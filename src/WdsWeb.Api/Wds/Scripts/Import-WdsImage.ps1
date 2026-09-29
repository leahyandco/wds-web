# Imports a boot or install image into WDS from a .wim, .esd or .iso on this server. An ISO is
# mounted read-only for the duration. WDS can't read .esd files, and it imports whichever image in a
# boot .wim is marked bootable, so when needed the chosen image is first exported to a temporary .wim.
# Progress goes to the information stream, which the web service shows as the import runs.
param(
    [Parameter(Mandatory)] [string] $Path,
    [string] $InnerPath,
    [Parameter(Mandatory)] [ValidateSet('Boot', 'Install')] [string] $Kind,
    [int] $Index = 1,
    [string] $ImageGroup,
    [switch] $CreateGroup,
    [Parameter(Mandatory)] [string] $Name,
    [string] $Description,
    [Parameter(Mandatory)] [string] $FileName,
    [Parameter(Mandatory)] [string] $TempFolder
)
$ErrorActionPreference = 'Stop'
$InformationPreference = 'Continue'
Assert-WdsModule

$iso = $null
try {
    $source = $Path
    if ([IO.Path]::GetExtension($Path) -eq '.iso') {
        if (-not $InnerPath) { throw 'Say which image file in the ISO to import.' }
        Write-Information "Mounting $(Split-Path $Path -Leaf)"
        $iso = Mount-WdsIso -Path $Path
        $source = Join-Path $iso.Root $InnerPath
    }
    if (-not (Test-Path -LiteralPath $source)) { throw "There's no image at $source." }

    $chosen = Get-WindowsImage -ImagePath $source -Index $Index
    $isEsd = [IO.Path]::GetExtension($source) -eq '.esd'
    $bootNeedsExport = $Kind -eq 'Boot' -and @(Get-WindowsImage -ImagePath $source).Count -gt 1 -and "$($chosen.ImageBootable)" -ne 'Yes'
    if ($isEsd -or $bootNeedsExport) {
        New-Item -ItemType Directory -Force -Path $TempFolder | Out-Null
        $exported = Join-Path $TempFolder 'export.wim'
        $reason = if ($isEsd) { "WDS can't read .esd files" } else { 'WDS imports the image marked bootable' }
        Write-Information "Copying image $Index ('$($chosen.ImageName)') to a temporary .wim, because $reason"
        $export = @{ SourceImagePath = $source; SourceIndex = $Index; DestinationImagePath = $exported; CompressionType = 'Max' }
        if ($Kind -eq 'Boot') { $export.Setbootable = $true }
        Export-WindowsImage @export | Out-Null
        $source = $exported
        $chosen = Get-WindowsImage -ImagePath $source -Index 1
    }

    if ($Kind -eq 'Install') {
        if (-not $ImageGroup) { throw 'Say which image group to import into.' }
        if (-not (Get-WdsInstallImageGroup -Name $ImageGroup -ErrorAction SilentlyContinue)) {
            if (-not $CreateGroup) { throw "There's no image group named $ImageGroup." }
            Write-Information "Creating image group $ImageGroup"
            New-WdsInstallImageGroup -Name $ImageGroup | Out-Null
        }
        Write-Information "Importing '$($chosen.ImageName)' into $ImageGroup as '$Name'. Large images take several minutes."
        $import = @{ Path = $source; ImageName = $chosen.ImageName; ImageGroup = $ImageGroup; NewImageName = $Name; NewFileName = $FileName }
        if ($Description) { $import.NewDescription = $Description }
        Import-WdsInstallImage @import | Out-Null
        $imported = Get-WdsInstallImage -ImageGroup $ImageGroup -ImageName $Name | Select-Object -First 1
    } else {
        Write-Information "Importing boot image '$Name'"
        $import = @{ Path = $source; NewImageName = $Name; NewFileName = $FileName }
        if ($Description) { $import.NewDescription = $Description }
        Import-WdsBootImage @import | Out-Null
        $imported = Get-WdsBootImage -ImageName $Name | Where-Object FileName -eq $FileName | Select-Object -First 1
    }

    Write-Information 'Import finished'
    ConvertTo-WdsJson $(if ($imported) { ConvertTo-WdsObject $imported } else { [ordered]@{} })
} finally {
    if ($iso -and $iso.MountedHere) { Dismount-DiskImage -ImagePath $Path | Out-Null }
    if (Test-Path -LiteralPath $TempFolder) { Remove-Item -LiteralPath $TempFolder -Recurse -Force -ErrorAction SilentlyContinue }
}
