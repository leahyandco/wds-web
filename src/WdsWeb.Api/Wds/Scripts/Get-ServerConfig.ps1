# Server-wide WDS settings. WDSUTIL is the only tool that reports them (the WDS module has no server
# cmdlets), and the web service parses its text. Also reports the RemoteInstall volume, the
# hands-free deployment override that the April 2026 update (CVE-2026-0386) turned off by default,
# and the choices the settings forms offer: the boot programs present and the network interfaces.
$ErrorActionPreference = 'Stop'

$config = Invoke-WdsUtil -Arguments '/Get-Server', '/Show:Config'

$remoteInstall = $null
$bootPrograms = @()
$root = Get-WdsRemoteInstallPath
if ($root) {
    $drive = New-Object System.IO.DriveInfo ([System.IO.Path]::GetPathRoot($root))
    $remoteInstall = [ordered]@{ path = $root; totalBytes = $drive.TotalSize; freeBytes = $drive.AvailableFreeSpace }
    # Boot programs sit directly in Boot\<architecture> (-Include is ignored alongside -LiteralPath,
    # hence the Where-Object).
    $bootPrograms = @(Get-ChildItem -LiteralPath (Join-Path $root 'Boot') -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        Get-ChildItem -LiteralPath $_.FullName -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.com', '.efi', '.n12' }
    } | ForEach-Object { $_.FullName.Substring($root.Length + 1) } | Sort-Object)
}

$interfaces = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' } | ForEach-Object {
    $adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
    [ordered]@{
        name       = $_.InterfaceAlias
        ipAddress  = $_.IPAddress
        macAddress = if ($adapter -and $adapter.MacAddress) { $adapter.MacAddress } else { $null }
        status     = if ($adapter) { "$($adapter.Status)" } else { $null }
    }
})

$handsFree = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\WdsServer\Providers\WdsImgSrv\Unattend' `
    -Name AllowHandsFreeFunctionality -ErrorAction SilentlyContinue

ConvertTo-WdsJson ([ordered]@{
    wdsUtilExitCode             = $config.ExitCode
    wdsUtilOutput               = $config.Output
    remoteInstall               = $remoteInstall
    allowHandsFreeFunctionality = if ($handsFree) { [int]$handsFree.AllowHandsFreeFunctionality } else { $null }
    bootPrograms                = $bootPrograms
    interfaces                  = $interfaces
})
