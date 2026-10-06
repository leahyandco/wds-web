# Runs once when a session opens on the WDS server (Windows PowerShell 5.1). Imports the WDS module
# and defines the helpers the other scripts share.

$ErrorActionPreference = 'Stop'

$global:WdsModuleLoaded = $false
if (Get-Module -ListAvailable -Name WDS) {
    Import-Module -Name WDS
    $global:WdsModuleLoaded = $true
}

# The scripts set $ErrorActionPreference = 'Stop', but the WDS cmdlets come from a module, which doesn't
# see a caller's preference: their errors would only be written, and a failed import or removal would
# look like it worked. Make them stop by default; an explicit -ErrorAction still wins.
$global:PSDefaultParameterValues['*-Wds*:ErrorAction'] = 'Stop'

function global:Assert-WdsModule {
    if (-not $global:WdsModuleLoaded) {
        throw "The WDS PowerShell module isn't installed on $env:COMPUTERNAME. Install the WDS role or its management tools (WDS-AdminPack)."
    }
}

# Reduces cmdlet output to ordered dictionaries, arrays and primitives so that ConvertTo-Json gives
# stable JSON: ISO 8601 dates, enum names rather than numbers, and none of the CIM plumbing.
function global:ConvertTo-WdsValue {
    param($Value, [int] $Depth = 4)

    if ($null -eq $Value) { return $null }
    if ($Value -is [string] -or $Value -is [bool]) { return $Value }
    if ($Value -is [datetime]) { return $Value.ToUniversalTime().ToString('o') }
    if ($Value -is [enum] -or $Value -is [guid] -or $Value -is [timespan] -or $Value -is [char] -or $Value -is [version]) {
        return $Value.ToString()
    }
    if ($Value -is [ValueType]) { return $Value }
    if ($Value -is [byte[]]) { return [Convert]::ToBase64String($Value) }
    if ($Depth -le 0) { return $Value.ToString() }
    if ($Value -is [System.Collections.IDictionary]) {
        $map = [ordered]@{}
        foreach ($key in $Value.Keys) { $map[[string]$key] = ConvertTo-WdsValue $Value[$key] ($Depth - 1) }
        return $map
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        # The leading comma stops PowerShell unrolling the array, even when it has one item or none.
        return , @(foreach ($item in $Value) { ConvertTo-WdsValue $item ($Depth - 1) })
    }
    return ConvertTo-WdsObject $Value $Depth
}

function global:ConvertTo-WdsObject {
    param([Parameter(Mandatory)] $InputObject, [int] $Depth = 4)

    $map = [ordered]@{}
    $base = $InputObject.PSObject.BaseObject
    if ($base.GetType().FullName -eq 'Microsoft.Management.Infrastructure.CimInstance') {
        foreach ($property in $base.CimInstanceProperties) {
            $map[$property.Name] = ConvertTo-WdsValue $property.Value ($Depth - 1)
        }
        # The module's type data redefines enum properties under the same names with readable values
        # (Architecture 3 becomes X64, Status 0 becomes Pending) and adds aliases such as ImageName.
        # Prefer those, but keep the raw value when a script property fails or returns nothing.
        foreach ($property in $InputObject.PSObject.Properties) {
            if ($property.MemberType -notin 'ScriptProperty', 'AliasProperty', 'NoteProperty' -or $property.Name -eq 'PSComputerName') {
                continue
            }
            $value = ConvertTo-WdsValue (Get-WdsPropertyValue $property) ($Depth - 1)
            if ($null -ne $value -or -not $map.Contains($property.Name)) { $map[$property.Name] = $value }
        }
        return $map
    }

    foreach ($property in $InputObject.PSObject.Properties) {
        if ($property.MemberType -in 'Property', 'NoteProperty', 'ScriptProperty', 'AliasProperty', 'CodeProperty') {
            $map[$property.Name] = ConvertTo-WdsValue (Get-WdsPropertyValue $property) ($Depth - 1)
        }
    }
    return $map
}

function global:Get-WdsPropertyValue {
    param($Property)
    try { $Property.Value } catch { $null }
}

# The named fields of an event: the elements of its UserData block (which WDS's PXE and TFTP events
# use), or else its EventData values, keyed by name or by position when unnamed.
function global:Get-WdsEventData {
    param([Parameter(Mandatory)] $Record)

    $eventXml = ([xml]$Record.ToXml()).Event
    $data = [ordered]@{}
    $userData = $eventXml['UserData']
    if ($userData -and $userData.FirstChild) {
        foreach ($field in $userData.FirstChild.ChildNodes) {
            if ($field.NodeType -eq 'Element') { $data[$field.LocalName] = $field.InnerText }
        }
        return $data
    }
    $eventData = $eventXml['EventData']
    if ($eventData) {
        $position = 0
        foreach ($field in $eventData.ChildNodes) {
            if ($field.NodeType -ne 'Element') { continue }
            $name = $field.GetAttribute('Name')
            $data[$(if ($name) { $name } else { "$position" })] = $field.InnerText
            $position++
        }
    }
    return $data
}

function global:ConvertTo-WdsJson {
    param($InputObject)
    ConvertTo-Json -InputObject $InputObject -Depth 12 -Compress
}

# Mounts an ISO read-only and returns its root (e.g. E:\), and whether this call mounted it, so the
# caller knows whether to dismount it. An ISO that's already mounted is used where it is.
function global:Mount-WdsIso {
    param([Parameter(Mandatory)] [string] $Path)

    $image = Get-DiskImage -ImagePath $Path
    $mountedHere = -not $image.Attached
    if ($mountedHere) { $image = Mount-DiskImage -ImagePath $Path -StorageType ISO -Access ReadOnly -PassThru }
    # Windows can take a moment to give the volume a drive letter.
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $volume = $image | Get-Volume -ErrorAction SilentlyContinue
        if ($volume.DriveLetter) {
            return [pscustomobject]@{ Root = "$($volume.DriveLetter):\"; Label = $volume.FileSystemLabel; MountedHere = $mountedHere }
        }
        Start-Sleep -Milliseconds 500
    }
    if ($mountedHere) { Dismount-DiskImage -ImagePath $Path | Out-Null }
    throw "Mounted $Path, but Windows didn't give it a drive letter."
}

# Every image in a .wim or .esd, with what's needed to choose one to import.
function global:Get-WdsImageIndexes {
    param([Parameter(Mandatory)] [string] $ImagePath)

    $architectures = @{ 0 = 'x86'; 5 = 'arm'; 6 = 'ia64'; 9 = 'x64'; 12 = 'arm64' }
    , @(Get-WindowsImage -ImagePath $ImagePath | ForEach-Object {
        $image = Get-WindowsImage -ImagePath $ImagePath -Index $_.ImageIndex
        $architecture = [int]$image.Architecture
        [ordered]@{
            index            = [int]$image.ImageIndex
            name             = $image.ImageName
            description      = $image.ImageDescription
            size             = [int64]$image.ImageSize
            architecture     = if ($architectures.ContainsKey($architecture)) { $architectures[$architecture] } else { "$architecture" }
            version          = "$($image.Version)"
            editionId        = $image.EditionId
            installationType = $image.InstallationType
            languages        = @($image.Languages)
            bootable         = "$($image.ImageBootable)" -eq 'Yes'
            modified         = if ($image.ModifiedTime) { $image.ModifiedTime.ToUniversalTime().ToString('o') } else { $null }
        }
    })
}

# The RemoteInstall folder: the root WDS's TFTP provider serves, set when WDS was initialized. Null if
# WDS isn't set up.
function global:Get-WdsRemoteInstallPath {
    $tftp = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\WDSServer\Providers\WDSTFTP' -ErrorAction SilentlyContinue
    if ($tftp -and $tftp.RootFolder -and (Test-Path -LiteralPath $tftp.RootFolder)) { $tftp.RootFolder.TrimEnd('\') } else { $null }
}

# Where WDS keeps an install image's unattend file: in the image group's folder, under a folder named
# after the image's file.
function global:Get-WdsImageUnattendPath {
    param([Parameter(Mandatory)] $Image)

    $root = Get-WdsRemoteInstallPath
    if (-not $root) { throw "Can't find the RemoteInstall folder on $env:COMPUTERNAME." }
    Join-Path $root ('Images\{0}\{1}\Unattend\ImageUnattend.xml' -f $Image.ImageGroup, [IO.Path]::GetFileNameWithoutExtension($Image.FileName))
}

# WDSUTIL only prints localized text, which the web service parses. Native stderr must not become a
# terminating error, so this runs with ErrorActionPreference Continue and returns the exit code too.
function global:Invoke-WdsUtil {
    param([Parameter(Mandatory)] [string[]] $Arguments)

    $exe = Join-Path $env:SystemRoot 'System32\wdsutil.exe'
    if (-not (Test-Path -LiteralPath $exe)) { throw "wdsutil.exe isn't installed on $env:COMPUTERNAME." }
    $ErrorActionPreference = 'Continue'
    $lines = & $exe @Arguments 2>&1 | ForEach-Object { "$_" }
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($lines -join "`n") }
}
