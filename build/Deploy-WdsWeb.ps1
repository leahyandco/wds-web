<#
.SYNOPSIS
Builds a release and installs it on another machine over WinRM, for development and testing.

.DESCRIPTION
Builds the package with Build-Release.ps1 (or takes -Package), copies it to -ComputerName,
extracts it there and runs Install-WdsWeb.ps1 with -InstallArguments. It's the same installer a
release uses; to install a published release, extract it on the target and run Install-WdsWeb.ps1
there instead.

.PARAMETER ComputerName
The machine to install on: the WDS server, or another machine for Remote mode.

.PARAMETER Credential
An administrator on that machine, for WinRM. Without it (or -CredentialFile), your own account.

.PARAMETER CredentialFile
Like -Credential, from a file saved with Get-Credential | Export-Clixml.

.PARAMETER InstallArguments
Parameters for Install-WdsWeb.ps1, such as @{ AllowedGroups = 'CONTOSO\WDS Admins' }.

.PARAMETER Package
A release zip to install instead of building one.

.EXAMPLE
.\build\Deploy-WdsWeb.ps1 -ComputerName wds01 -InstallArguments @{ AllowedGroups = 'CONTOSO\WDS Admins' }
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $ComputerName,
    [pscredential] $Credential,
    [string] $CredentialFile,
    [hashtable] $InstallArguments = @{},
    [string] $Package
)
$ErrorActionPreference = 'Stop'

if (-not $Package) { $Package = & (Join-Path $PSScriptRoot 'Build-Release.ps1') | Select-Object -Last 1 }
if (-not (Test-Path -LiteralPath $Package)) { throw "There's no package at $Package." }
if (-not $Credential -and $CredentialFile) { $Credential = Import-Clixml -LiteralPath $CredentialFile }

$connection = @{ ComputerName = $ComputerName }
if ($Credential) { $connection.Credential = $Credential }
$session = New-PSSession @connection
try {
    $remoteFolder = Invoke-Command -Session $session -ScriptBlock { Join-Path $env:TEMP "WdsWeb-release-$([guid]::NewGuid().ToString('N'))" }
    $remoteZip = "$remoteFolder.zip"
    Write-Host "Copying $(Split-Path -Leaf $Package) to $ComputerName ($([math]::Round((Get-Item -LiteralPath $Package).Length / 1MB)) MB)..."
    Copy-Item -LiteralPath $Package -Destination $remoteZip -ToSession $session -Force

    Invoke-Command -Session $session -ArgumentList $remoteZip, $remoteFolder, $InstallArguments -ScriptBlock {
        param($zip, $folder, $arguments)
        $ErrorActionPreference = 'Stop'
        try {
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $folder)
            $installer = Get-ChildItem -LiteralPath $folder -Filter 'Install-WdsWeb.ps1' -Recurse | Select-Object -First 1
            & $installer.FullName @arguments
        } finally {
            Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
} finally {
    Remove-PSSession $session
}
