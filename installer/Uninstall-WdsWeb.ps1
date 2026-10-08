<#
.SYNOPSIS
Removes the WDS Console service and its program files from this machine.

.DESCRIPTION
Settings, the sign-in cookie keys and any saved credential (C:\ProgramData\WdsWeb) are kept, so a
later install picks up where this one left off, unless -RemoveData is given. WDS itself, its images
and its settings are never touched.

.PARAMETER RemoveData
Also delete C:\ProgramData\WdsWeb, the self-signed certificate the installer created, and the event
log source.

.PARAMETER InstallPath
Where the program files are, if not the default C:\Program Files\WdsWeb.
#>

#Requires -Version 5.1
#Requires -PSEdition Desktop
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [switch] $RemoveData,
    [string] $InstallPath = (Join-Path $env:ProgramFiles 'WdsWeb')
)
$ErrorActionPreference = 'Stop'

$serviceName = 'WdsWeb'
$dataPath = Join-Path $env:ProgramData 'WdsWeb'

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne 'Stopped') {
        Stop-Service -Name $serviceName -Force
        (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
    }
    sc.exe delete $serviceName | Out-Null
    Write-Host "- Removed the $serviceName service"
}

if (Get-NetFirewallRule -Name 'WdsWeb-Https' -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -Name 'WdsWeb-Https'
    Write-Host '- Removed the firewall rule'
}

if (Test-Path -LiteralPath (Join-Path $InstallPath 'WdsWeb.Api.exe')) {
    Remove-Item -LiteralPath $InstallPath -Recurse -Force
    Write-Host "- Removed $InstallPath"
}

if ($RemoveData) {
    $settingsPath = Join-Path $dataPath 'settings.json'
    if (Test-Path -LiteralPath $settingsPath) {
        $thumbprint = try { (Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json).Https.CertificateThumbprint } catch { $null }
        # Only the certificate the installer made, which it names 'WDS Console'; never one you supplied.
        $certificate = if ($thumbprint) { Get-Item -LiteralPath "Cert:\LocalMachine\My\$thumbprint" -ErrorAction SilentlyContinue }
        if ($certificate -and $certificate.FriendlyName -eq 'WDS Console' -and $certificate.Subject -eq $certificate.Issuer) {
            Remove-Item -LiteralPath $certificate.PSPath
            Write-Host '- Removed the self-signed certificate'
        }
    }
    if (Test-Path -LiteralPath $dataPath) {
        Remove-Item -LiteralPath $dataPath -Recurse -Force
        Write-Host "- Removed $dataPath"
    }
    if ([System.Diagnostics.EventLog]::SourceExists('WDS Console')) {
        [System.Diagnostics.EventLog]::DeleteEventSource('WDS Console')
        Write-Host '- Removed the event log source'
    }
} else {
    Write-Host "Kept $dataPath (settings, keys, credential). Run again with -RemoveData to delete it."
}
