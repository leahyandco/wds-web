# What's inside a .wim, .esd or .iso on the WDS server: each image in it, with what's needed to pick
# one to import. An ISO is mounted read-only while its boot and install images are read.
param([Parameter(Mandatory)] [string] $Path)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "There's no file at $Path on $env:COMPUTERNAME." }
$file = Get-Item -LiteralPath $Path
$extension = $file.Extension.ToLowerInvariant()
if ($extension -notin '.iso', '.wim', '.esd') { throw "$($file.Name) isn't an .iso, .wim or .esd file." }

$result = [ordered]@{
    path    = $file.FullName
    name    = $file.Name
    size    = $file.Length
    format  = $extension.TrimStart('.')
    label   = $null
    warning = $null
    files   = @()
}

if ($extension -eq '.iso') {
    $iso = Mount-WdsIso -Path $file.FullName
    try {
        $result.label = $iso.Label
        foreach ($inner in 'sources\boot.wim', 'sources\install.wim', 'sources\install.esd') {
            $imagePath = Join-Path $iso.Root $inner
            if (-not (Test-Path -LiteralPath $imagePath)) { continue }
            $result.files += [ordered]@{
                innerPath = $inner
                role      = if ($inner -like '*boot.wim') { 'boot' } else { 'install' }
                format    = [IO.Path]::GetExtension($inner).TrimStart('.')
                size      = (Get-Item -LiteralPath $imagePath).Length
                images    = Get-WdsImageIndexes -ImagePath $imagePath
            }
        }
        if (Test-Path -LiteralPath (Join-Path $iso.Root 'sources\install.swm')) {
            $result.warning = "This ISO's install image is split into .swm files, which WDS can't import. Merge them into one .wim with DISM first."
        }
    } finally {
        if ($iso.MountedHere) { Dismount-DiskImage -ImagePath $file.FullName | Out-Null }
    }
} else {
    $images = Get-WdsImageIndexes -ImagePath $file.FullName
    # A file of nothing but WinPE images is a boot image; anything else is an install image.
    $isBoot = @($images | Where-Object { $_.installationType -ne 'WindowsPE' }).Count -eq 0
    $result.files += [ordered]@{
        innerPath = $null
        role      = if ($isBoot) { 'boot' } else { 'install' }
        format    = $extension.TrimStart('.')
        size      = $file.Length
        images    = $images
    }
}

ConvertTo-WdsJson $result
