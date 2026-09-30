<#
.SYNOPSIS
Builds the WDS Console and installs or updates it as a Windows service on a WDS server.

.DESCRIPTION
Run from a development machine that can reach the server over WinRM (see the README). It builds the
frontend, publishes a self-contained build (so the server needs no .NET runtime), copies it to the
server and installs it as the WdsWeb service, running as LocalSystem and managing WDS locally.

The first run also creates, on the server:
  - a self-signed HTTPS certificate for the server's names and addresses (LocalMachine\My),
  - C:\ProgramData\WdsWeb\settings.json with the HTTPS port and that certificate's thumbprint,
  - the "WDS Console" event log source, a firewall rule for the port, and the service itself.
Later runs only replace the program files and restart the service; they leave all of that alone.

.EXAMPLE
.\deploy\Deploy-WdsWeb.ps1
.\deploy\Deploy-WdsWeb.ps1 -ComputerName wds01 -Port 8443 -SkipBuild
#>
[CmdletBinding()]
param(
    [string] $ComputerName = 'wds01',
    [string] $CredentialFile = "$env:APPDATA\wds-web\$ComputerName.credential.xml",
    [string] $InstallPath = 'C:\Program Files\WdsWeb',
    [int] $Port = 8443,
    [switch] $SkipBuild
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repo = Split-Path -Parent $PSScriptRoot
$publish = Join-Path $repo 'artifacts\publish'
$package = Join-Path $repo 'artifacts\WdsWeb.zip'

# Judge a build tool by its exit code. Tools like Vite print warnings to stderr, which Windows
# PowerShell would otherwise turn into a terminating error under $ErrorActionPreference = 'Stop'.
function Invoke-Tool([string] $What, [scriptblock] $Command) {
    $ErrorActionPreference = 'Continue'
    & $Command 2>&1 | ForEach-Object { Write-Host "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

if (-not $SkipBuild) {
    Write-Host 'Building the frontend...'
    Invoke-Tool 'The frontend build' { npm run build --prefix (Join-Path $repo 'web') }

    Write-Host 'Publishing a self-contained build...'
    if (Test-Path $publish) { Remove-Item -LiteralPath $publish -Recurse -Force }
    Invoke-Tool 'dotnet publish' { dotnet publish (Join-Path $repo 'src\WdsWeb.Api') -c Release -r win-x64 --self-contained true -o $publish -p:DebugType=none }
}
if (-not (Test-Path (Join-Path $publish 'WdsWeb.Api.exe'))) { throw "There's no build in $publish; run without -SkipBuild." }
if (Test-Path $package) { Remove-Item -LiteralPath $package -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($publish, $package)

$credential = if (Test-Path $CredentialFile) { Import-Clixml $CredentialFile } else { Get-Credential -Message "An administrator on $ComputerName" }
$session = New-PSSession -ComputerName $ComputerName -Credential $credential
try {
    $remotePackage = Invoke-Command -Session $session -ScriptBlock { Join-Path $env:TEMP 'WdsWeb.zip' }
    Write-Host "Copying the build to $ComputerName ($([math]::Round((Get-Item $package).Length / 1MB)) MB)..."
    Copy-Item -LiteralPath $package -Destination $remotePackage -ToSession $session -Force

    Invoke-Command -Session $session -ArgumentList $remotePackage, $InstallPath, $Port -ScriptBlock {
        param($package, $installPath, $port)
        $ErrorActionPreference = 'Stop'
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $serviceName = 'WdsWeb'
        $dataPath = Join-Path $env:ProgramData 'WdsWeb'
        New-Item -ItemType Directory -Force -Path $dataPath | Out-Null

        # First install: a certificate for the names and addresses browsers will use, and the
        # machine settings that point the service at it.
        $settingsPath = Join-Path $dataPath 'settings.json'
        if (-not (Test-Path $settingsPath)) {
            $names = @($env:COMPUTERNAME.ToLowerInvariant())
            $fqdn = [System.Net.Dns]::GetHostEntry('').HostName.ToLowerInvariant()
            if ($fqdn -ne $names[0]) { $names += $fqdn }
            $addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object IPAddress)
            $san = (@($names | ForEach-Object { "DNS=$_" }) + @($addresses | ForEach-Object { "IPAddress=$_" })) -join '&'
            $certificate = New-SelfSignedCertificate -Subject "CN=$($names[0])" -FriendlyName 'WDS Console' `
                -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddYears(5) -KeyExportPolicy NonExportable `
                -TextExtension @("2.5.29.17={text}$san", '2.5.29.37={text}1.3.6.1.5.5.7.3.1')
            [ordered]@{ Https = [ordered]@{ Port = $port; CertificateThumbprint = $certificate.Thumbprint } } |
                ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding UTF8
            Write-Output "Created an HTTPS certificate ($($certificate.Thumbprint)) for $(($names + $addresses) -join ', ')"
        }

        if (-not [System.Diagnostics.EventLog]::SourceExists('WDS Console')) { New-EventLog -LogName Application -Source 'WDS Console' }

        $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if ($service -and $service.Status -ne 'Stopped') {
            Stop-Service -Name $serviceName -Force
            (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
        }

        # Unpack beside the install folder first, so a broken package can't leave half an install.
        $unpacked = Join-Path $env:TEMP 'WdsWeb-new'
        if (Test-Path $unpacked) { Remove-Item -LiteralPath $unpacked -Recurse -Force }
        [IO.Compression.ZipFile]::ExtractToDirectory($package, $unpacked)
        New-Item -ItemType Directory -Force -Path $installPath | Out-Null
        robocopy $unpacked $installPath /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "Copying the program files failed (robocopy exit code $LASTEXITCODE)." }
        Remove-Item -LiteralPath $unpacked -Recurse -Force
        Remove-Item -LiteralPath $package -Force

        if (-not $service) {
            $exe = Join-Path $installPath 'WdsWeb.Api.exe'
            New-Service -Name $serviceName -DisplayName 'WDS Console' -Description 'Web console for Windows Deployment Services.' `
                -BinaryPathName "`"$exe`"" -StartupType Automatic | Out-Null
            # Restart after a crash: 5 s, then 10 s, then 1 min; forget failures after a day.
            sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/10000/restart/60000 | Out-Null
            Write-Output "Created the $serviceName service"
        }
        if (-not (Get-NetFirewallRule -Name 'WdsWeb-Https' -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -Name 'WdsWeb-Https' -DisplayName 'WDS Console (HTTPS)' -Direction Inbound -Protocol TCP `
                -LocalPort $port -Action Allow -Profile Domain, Private | Out-Null
        }

        Start-Service -Name $serviceName
        # Wait for it to answer over HTTPS. curl.exe (in Windows since 1803) with -k, because the
        # certificate is self-signed and doesn't name localhost; a PowerShell certificate callback
        # can't run on the thread TLS uses in a remote session.
        $healthy = $false
        $deadline = (Get-Date).AddSeconds(90)
        while (-not $healthy -and (Get-Date) -lt $deadline) {
            $healthy = (curl.exe -sk --max-time 5 "https://localhost:$port/api/health") -match '"ok"'
            if (-not $healthy) { Start-Sleep -Seconds 2 }
        }
        if (-not $healthy) { throw "The service started, but https://localhost:$port/api/health didn't answer. Check the Application event log." }

        # And that it can manage WDS: the deep check opens a PowerShell session and asks WDS.
        $deep = (curl.exe -sk --max-time 120 "https://localhost:$port/api/health?deep=true") | Out-String
        $check = try { $deep | ConvertFrom-Json } catch { $null }
        if (-not $check -or $check.status -ne 'ok') { throw "The service is up but can't manage WDS: $deep" }
        Write-Output "The $serviceName service is $((Get-Service -Name $serviceName).Status.ToString().ToLowerInvariant()) and can manage WDS on $($check.server) (Windows PowerShell $($check.psVersion), WDS module $($check.wdsModule), WDS service $($check.wdsService.status))"
    }
}
finally {
    Remove-PSSession $session
}
Write-Host "WDS Console: https://$($ComputerName.ToLowerInvariant()):$Port/"
