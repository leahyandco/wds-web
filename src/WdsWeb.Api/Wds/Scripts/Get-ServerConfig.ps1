# Server-wide WDS settings. WDSUTIL is the only tool that reports them (the WDS module has no server
# cmdlets), and the web service parses its text. Also reports the RemoteInstall volume and the
# hands-free deployment override that the April 2026 update (CVE-2026-0386) turned off by default.
$ErrorActionPreference = 'Stop'

$config = Invoke-WdsUtil -Arguments '/Get-Server', '/Show:Config'

$remoteInstall = $null
$tftp = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\WDSServer\Providers\WDSTFTP' -ErrorAction SilentlyContinue
if ($tftp -and $tftp.RootFolder -and (Test-Path -LiteralPath $tftp.RootFolder)) {
    $drive = New-Object System.IO.DriveInfo ([System.IO.Path]::GetPathRoot($tftp.RootFolder))
    $remoteInstall = [ordered]@{ path = $tftp.RootFolder; totalBytes = $drive.TotalSize; freeBytes = $drive.AvailableFreeSpace }
}

$handsFree = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\WdsServer\Providers\WdsImgSrv\Unattend' `
    -Name AllowHandsFreeFunctionality -ErrorAction SilentlyContinue

ConvertTo-WdsJson ([ordered]@{
    wdsUtilExitCode             = $config.ExitCode
    wdsUtilOutput               = $config.Output
    remoteInstall               = $remoteInstall
    allowHandsFreeFunctionality = if ($handsFree) { [int]$handsFree.AllowHandsFreeFunctionality } else { $null }
})
