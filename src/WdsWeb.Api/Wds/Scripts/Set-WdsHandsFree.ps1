# Allows or blocks hands-free deployment: whether WDS hands the WDS client unattend file to clients
# that haven't authenticated. The April 2026 update (CVE-2026-0386) blocks it unless this registry
# value is 1; 0 blocks it explicitly. See https://go.microsoft.com/fwlink/?linkid=2344403.
param([Parameter(Mandatory)] [bool] $Allow)
$ErrorActionPreference = 'Stop'

$key = 'HKLM:\SYSTEM\CurrentControlSet\Services\WdsServer\Providers\WdsImgSrv\Unattend'
if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }
Set-ItemProperty -LiteralPath $key -Name AllowHandsFreeFunctionality -Value ([int]$Allow) -Type DWord

ConvertTo-WdsJson ([ordered]@{
    allowHandsFreeFunctionality = [int](Get-ItemProperty -LiteralPath $key -Name AllowHandsFreeFunctionality).AllowHandsFreeFunctionality
})
