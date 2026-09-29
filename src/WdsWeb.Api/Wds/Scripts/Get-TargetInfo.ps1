# Identifies the WDS server: OS, domain membership, WDS role services, and the module and service state.
$ErrorActionPreference = 'Stop'

$os = Get-CimInstance -ClassName Win32_OperatingSystem
$computer = Get-CimInstance -ClassName Win32_ComputerSystem

$features = @()
if (Get-Command -Name Get-WindowsFeature -ErrorAction SilentlyContinue) {
    $features = @(Get-WindowsFeature -Name WDS, WDS-Deployment, WDS-Transport, WDS-AdminPack | ForEach-Object {
        [ordered]@{ name = $_.Name; displayName = $_.DisplayName; installed = [bool]$_.Installed }
    })
}

$service = Get-Service -Name WDSServer -ErrorAction SilentlyContinue
$module = Get-Module -Name WDS

ConvertTo-WdsJson ([ordered]@{
    computerName = $env:COMPUTERNAME
    osCaption    = $os.Caption
    osVersion    = $os.Version
    osBuild      = $os.BuildNumber
    lastBootTime = $os.LastBootUpTime.ToUniversalTime().ToString('o')
    partOfDomain = [bool]$computer.PartOfDomain
    domain       = $computer.Domain
    psVersion    = $PSVersionTable.PSVersion.ToString()
    features     = $features
    wdsService   = if ($service) { [ordered]@{ status = $service.Status.ToString(); startType = $service.StartType.ToString() } } else { $null }
    wdsModule    = if ($module) { $module.Version.ToString() } else { $null }
})
