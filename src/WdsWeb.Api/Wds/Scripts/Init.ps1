# Runs once when a session opens on the WDS server (Windows PowerShell 5.1). Imports the WDS module
# and defines the helpers the other scripts share.

$ErrorActionPreference = 'Stop'

$global:WdsModuleLoaded = $false
if (Get-Module -ListAvailable -Name WDS) {
    Import-Module -Name WDS
    $global:WdsModuleLoaded = $true
}

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
