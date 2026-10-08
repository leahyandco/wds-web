<#
.SYNOPSIS
Installs, updates or reconfigures the WDS Console as a Windows service on this machine.

.DESCRIPTION
Run it from an elevated PowerShell in the folder the release was extracted to. Run it again at any
time: to update to a newer release, or to change a setting by giving just that parameter.

The console runs either on the WDS server itself (Local mode, the default when WDS is installed
here), or on another Windows machine that manages the WDS server over WinRM (Remote mode, chosen by
giving -WdsServer).

Settings are kept in C:\ProgramData\WdsWeb\settings.json, which updates leave alone. The parameters
below are written there; see docs\configuration.md for everything else it can hold. That folder is
made readable by SYSTEM and Administrators only, since it holds the sign-in cookie keys and any
saved credential.

.PARAMETER WdsServer
Manage this WDS server over WinRM (Remote mode). The console's machine needs WinRM access to it, and
its administrative share (C$) for uploads.

.PARAMETER Local
Switch back to Local mode: manage WDS on this machine.

.PARAMETER Credential
Remote mode: the account to connect to the WDS server as, which must be an administrator there.
It's saved in C:\ProgramData\WdsWeb\credential.json, protected for this machine. Without it, the
console connects as its service account, LocalSystem, which the WDS server sees as this computer's
domain account (for example CONTOSO\CONSOLE01$); add that to the WDS server's Administrators group.

.PARAMETER NoCredential
Remote mode: forget the saved credential and connect as the service account.

.PARAMETER AllowedGroups
Windows groups whose members may sign in, local or domain, such as 'CONTOSO\WDS Admins'. Replaces
the configured list. The first install allows BUILTIN\Administrators when no groups or users are given.

.PARAMETER AllowedUsers
Individual Windows accounts that may sign in, such as 'CONTOSO\jdoe'. Replaces the configured list.

.PARAMETER Port
The HTTPS port to listen on. 8443 by default.

.PARAMETER CertificateThumbprint
A certificate in LocalMachine\My (with its private key) to use instead of the self-signed one that
the first install creates.

.PARAMETER InstallPath
Where the program files go. C:\Program Files\WdsWeb by default.

.PARAMETER TrustWdsServer
Remote mode: add the WDS server to this machine's WinRM TrustedHosts list. WinRM needs that before
it will send a password to a server outside this machine's domain, or one named by IP address.

.EXAMPLE
.\Install-WdsWeb.ps1 -AllowedGroups 'CONTOSO\WDS Admins'

On the WDS server: installs the console in Local mode and lets the WDS Admins group sign in.

.EXAMPLE
.\Install-WdsWeb.ps1 -WdsServer wds01 -Credential (Get-Credential CONTOSO\svc-wds) -AllowedGroups 'CONTOSO\WDS Admins'

On another machine: manages wds01 over WinRM as CONTOSO\svc-wds.

.EXAMPLE
.\Install-WdsWeb.ps1 -AllowedUsers 'CONTOSO\jdoe', 'CONTOSO\asmith'

Later: changes who may sign in, and restarts the service.
#>

#Requires -Version 5.1
#Requires -PSEdition Desktop
#Requires -RunAsAdministrator
[CmdletBinding(DefaultParameterSetName = 'Keep')]
param(
    [Parameter(ParameterSetName = 'Remote', Mandatory)] [string] $WdsServer,
    [Parameter(ParameterSetName = 'Local', Mandatory)] [switch] $Local,
    [Parameter(ParameterSetName = 'Remote')] [Parameter(ParameterSetName = 'Keep')] [pscredential] $Credential,
    [Parameter(ParameterSetName = 'Remote')] [Parameter(ParameterSetName = 'Keep')] [switch] $NoCredential,
    [Parameter(ParameterSetName = 'Remote')] [switch] $TrustWdsServer,
    [string[]] $AllowedGroups,
    [string[]] $AllowedUsers,
    [ValidateRange(1, 65535)] [int] $Port,
    [string] $CertificateThumbprint,
    [string] $InstallPath = (Join-Path $env:ProgramFiles 'WdsWeb')
)
$ErrorActionPreference = 'Stop'

$serviceName = 'WdsWeb'
$eventSource = 'WDS Console'
$firewallRule = 'WdsWeb-Https'
$dataPath = Join-Path $env:ProgramData 'WdsWeb'
$settingsPath = Join-Path $dataPath 'settings.json'
$credentialPath = Join-Path $dataPath 'credential.json'
$appSource = Join-Path $PSScriptRoot 'app'

function Write-Step([string] $Text) { Write-Host "- $Text" }

# ---- Settings files -------------------------------------------------------------------------------

# settings.json as nested ordered dictionaries, which keep their order and are easy to change.
function ConvertTo-Tree($Value) {
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $map = [ordered]@{}
        foreach ($property in $Value.PSObject.Properties) { $map[$property.Name] = ConvertTo-Tree $property.Value }
        return $map
    }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        return , @($Value | ForEach-Object { ConvertTo-Tree $_ })
    }
    return $Value
}

function ConvertTo-JsonString([string] $Text) {
    $builder = New-Object System.Text.StringBuilder '"'
    foreach ($c in $Text.ToCharArray()) {
        switch ($c) {
            '"' { [void]$builder.Append('\"') }
            '\' { [void]$builder.Append('\\') }
            default {
                if ([int]$c -lt 0x20) { [void]$builder.AppendFormat('\u{0:x4}', [int]$c) } else { [void]$builder.Append($c) }
            }
        }
    }
    [void]$builder.Append('"')
    $builder.ToString()
}

# Windows PowerShell's ConvertTo-Json indents oddly; this writes JSON the way people expect to read it.
function ConvertTo-ReadableJson($Value, [int] $Depth = 0) {
    $indent = '  ' * $Depth
    $inner = '  ' * ($Depth + 1)
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [bool]) { return $Value.ToString().ToLowerInvariant() }
    if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) {
        return $Value.ToString([System.Globalization.CultureInfo]::InvariantCulture)
    }
    if ($Value -is [string]) { return ConvertTo-JsonString $Value }
    if ($Value -is [System.Collections.IDictionary]) {
        if ($Value.Count -eq 0) { return '{}' }
        $items = foreach ($key in $Value.Keys) { "$inner$(ConvertTo-JsonString $key): $(ConvertTo-ReadableJson $Value[$key] ($Depth + 1))" }
        return "{`n$($items -join ",`n")`n$indent}"
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $array = @($Value)
        if ($array.Count -eq 0) { return '[]' }
        $items = foreach ($item in $array) { "$inner$(ConvertTo-ReadableJson $item ($Depth + 1))" }
        return "[`n$($items -join ",`n")`n$indent]"
    }
    return ConvertTo-JsonString ([string]$Value)
}

function Get-Section([System.Collections.IDictionary] $Settings, [string] $Name) {
    if (-not $Settings.Contains($Name) -or $Settings[$Name] -isnot [System.Collections.IDictionary]) { $Settings[$Name] = [ordered]@{} }
    $Settings[$Name]
}

# Only SYSTEM and Administrators get in: the folder holds the cookie keys and any saved credential.
function Protect-Folder([string] $Path) {
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleAll($rule) }
    foreach ($sid in 'S-1-5-18', 'S-1-5-32-544') {
        $identity = New-Object System.Security.Principal.SecurityIdentifier $sid
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
            $identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

# The format StoredCredential reads: the UTF-16 password protected with DPAPI for this machine.
function Save-Credential([pscredential] $Value, [string] $Path) {
    Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue
    $plain = [System.Text.Encoding]::Unicode.GetBytes($Value.GetNetworkCredential().Password)
    try {
        $protected = [System.Security.Cryptography.ProtectedData]::Protect(
            $plain, [System.Text.Encoding]::UTF8.GetBytes('WdsWeb'), [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
    } finally {
        [Array]::Clear($plain, 0, $plain.Length)
    }
    $json = ConvertTo-ReadableJson ([ordered]@{ userName = $Value.UserName; password = [Convert]::ToBase64String($protected) })
    [System.IO.File]::WriteAllText($Path, $json + "`n", (New-Object System.Text.UTF8Encoding $false))
}

function Test-AccountName([string] $Name) {
    try {
        [void](New-Object System.Security.Principal.NTAccount $Name).Translate([System.Security.Principal.SecurityIdentifier])
        $true
    } catch {
        $false
    }
}

# ---- Checks ----------------------------------------------------------------------------------------

if (-not (Test-Path -LiteralPath (Join-Path $appSource 'WdsWeb.Api.exe'))) {
    throw "There's no app folder next to this script. Run it from the folder the release was extracted to."
}
if ($Credential -and $NoCredential) { throw 'Give -Credential or -NoCredential, not both.' }
# The copy mirrors the release into the folder, deleting anything else there, so it must be ours or new.
if ((Test-Path -LiteralPath $InstallPath) -and (Get-ChildItem -LiteralPath $InstallPath -Force | Select-Object -First 1) -and
    -not (Test-Path -LiteralPath (Join-Path $InstallPath 'WdsWeb.Api.exe'))) {
    throw "$InstallPath already holds other files. Choose an empty or new folder for -InstallPath."
}

New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
Protect-Folder $dataPath

$settings = [ordered]@{}
if (Test-Path -LiteralPath $settingsPath) {
    try {
        $settings = ConvertTo-Tree (Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json)
    } catch {
        throw "$settingsPath isn't plain JSON, so it can't be updated (comments aren't allowed here): $($_.Exception.Message)"
    }
}
$firstInstall = -not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)
$wds = Get-Section $settings 'Wds'
$auth = Get-Section $settings 'Auth'
$https = Get-Section $settings 'Https'

# ---- Mode and connection ---------------------------------------------------------------------------

$wdsHere = [bool](Get-Service -Name WDSServer -ErrorAction SilentlyContinue)
if ($PSCmdlet.ParameterSetName -eq 'Remote') {
    $wds['Mode'] = 'Remote'
    $wds['ComputerName'] = $WdsServer
} elseif ($Local) {
    $wds['Mode'] = 'Local'
    $wds.Remove('ComputerName')
    $wds.Remove('CredentialFile')
} elseif (-not $wds.Contains('Mode')) {
    $wds['Mode'] = 'Local'
}
if ($wds['Mode'] -eq 'Local' -and -not $wdsHere) {
    throw "Windows Deployment Services isn't installed on this machine. Run this on the WDS server, or give -WdsServer to manage one from here."
}

if ($Credential) {
    if ($wds['Mode'] -ne 'Remote') { throw '-Credential is for Remote mode: give -WdsServer as well.' }
    Save-Credential $Credential $credentialPath
    $wds['CredentialFile'] = $credentialPath
    Write-Step "Saved the credential for $($Credential.UserName), protected for this machine"
} elseif ($NoCredential -or $wds['Mode'] -eq 'Local') {
    $wds.Remove('CredentialFile')
    if (Test-Path -LiteralPath $credentialPath) { Remove-Item -LiteralPath $credentialPath -Force }
}

if ($wds['Mode'] -eq 'Remote') {
    $server = $wds['ComputerName']
    if ($TrustWdsServer) {
        $trusted = (Get-Item WSMan:\localhost\Client\TrustedHosts).Value
        if (($trusted -split ',' | ForEach-Object { $_.Trim() }) -notcontains $server) {
            Set-Item WSMan:\localhost\Client\TrustedHosts -Value $server -Concatenate -Force
            Write-Step "Added $server to WinRM TrustedHosts"
        }
    }
    # Only proves WinRM answers; whether the console's account may use it shows once the service runs.
    try {
        Test-WSMan -ComputerName $server -ErrorAction Stop | Out-Null
    } catch {
        throw "WinRM on $server doesn't answer from here: $($_.Exception.Message) Enable it there with Enable-PSRemoting, and allow port 5985 through its firewall."
    }
}

# ---- Sign-in -----------------------------------------------------------------------------------------

if ($PSBoundParameters.ContainsKey('AllowedGroups')) { $auth['AllowedGroups'] = @($AllowedGroups | Where-Object { $_ }) }
if ($PSBoundParameters.ContainsKey('AllowedUsers')) { $auth['AllowedUsers'] = @($AllowedUsers | Where-Object { $_ }) }
if (-not $auth.Contains('AllowedGroups') -and -not $auth.Contains('AllowedUsers')) { $auth['AllowedGroups'] = @('BUILTIN\Administrators') }
$allowed = @(@($auth['AllowedGroups']) + @($auth['AllowedUsers']) | Where-Object { $_ })
if ($allowed.Count -eq 0) { throw 'Nobody would be able to sign in: give -AllowedGroups or -AllowedUsers.' }
$unknown = @($allowed | Where-Object { -not (Test-AccountName $_) })
if ($unknown.Count -eq $allowed.Count) { throw "Windows can't find any of the allowed groups or users ($($allowed -join ', ')), so nobody could sign in." }
foreach ($name in $unknown) { Write-Warning "Windows can't find '$name', so it won't let anyone in." }

# ---- HTTPS -----------------------------------------------------------------------------------------

if ($Port) { $https['Port'] = $Port } elseif (-not $https.Contains('Port')) { $https['Port'] = 8443 }
$port = [int]$https['Port']

if ($CertificateThumbprint) {
    $thumbprint = ($CertificateThumbprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
    $certificate = Get-Item -LiteralPath "Cert:\LocalMachine\My\$thumbprint" -ErrorAction SilentlyContinue
    if (-not $certificate) { throw "There's no certificate with thumbprint $thumbprint in LocalMachine\My." }
    if (-not $certificate.HasPrivateKey) { throw "The certificate $thumbprint has no private key on this machine." }
    $https['CertificateThumbprint'] = $thumbprint
} elseif (-not ($https.Contains('CertificateThumbprint') -and (Test-Path -LiteralPath "Cert:\LocalMachine\My\$($https['CertificateThumbprint'])"))) {
    # A self-signed certificate for the names and addresses browsers will use.
    $names = @($env:COMPUTERNAME.ToLowerInvariant())
    $fqdn = [System.Net.Dns]::GetHostEntry('').HostName.ToLowerInvariant()
    if ($fqdn -ne $names[0]) { $names += $fqdn }
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object IPAddress)
    $san = (@($names | ForEach-Object { "DNS=$_" }) + @($addresses | ForEach-Object { "IPAddress=$_" })) -join '&'
    $certificate = New-SelfSignedCertificate -Subject "CN=$($names[0])" -FriendlyName 'WDS Console' `
        -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddYears(5) -KeyExportPolicy NonExportable `
        -TextExtension @("2.5.29.17={text}$san", '2.5.29.37={text}1.3.6.1.5.5.7.3.1')
    $https['CertificateThumbprint'] = $certificate.Thumbprint
    Write-Step "Created a self-signed HTTPS certificate for $(($names + $addresses) -join ', ')"
}

[System.IO.File]::WriteAllText($settingsPath, (ConvertTo-ReadableJson $settings) + "`n", (New-Object System.Text.UTF8Encoding $false))
Write-Step "Saved $settingsPath"

# ---- Program files and service ------------------------------------------------------------------------

if (-not [System.Diagnostics.EventLog]::SourceExists($eventSource)) { [System.Diagnostics.EventLog]::CreateEventSource($eventSource, 'Application') }

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne 'Stopped') {
    Stop-Service -Name $serviceName -Force
    (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
}

New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
robocopy $appSource $InstallPath /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the program files failed (robocopy exit code $LASTEXITCODE)." }
Write-Step "Copied the program to $InstallPath"

$exe = Join-Path $InstallPath 'WdsWeb.Api.exe'
if (-not $service) {
    New-Service -Name $serviceName -DisplayName 'WDS Console' -Description 'Web console for Windows Deployment Services.' `
        -BinaryPathName "`"$exe`"" -StartupType Automatic | Out-Null
    # Restart after a crash: after 5 s, then 10 s, then a minute; forget failures after a day.
    sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/10000/restart/60000 | Out-Null
    Write-Step "Created the $serviceName service"
} else {
    sc.exe config $serviceName binPath= "`"$exe`"" | Out-Null
}

$rule = Get-NetFirewallRule -Name $firewallRule -ErrorAction SilentlyContinue
if (-not $rule) {
    New-NetFirewallRule -Name $firewallRule -DisplayName 'WDS Console (HTTPS)' -Direction Inbound -Protocol TCP `
        -LocalPort $port -Action Allow -Profile Domain, Private | Out-Null
} else {
    Set-NetFirewallRule -Name $firewallRule -LocalPort $port
}

Start-Service -Name $serviceName

# ---- Check it works ----------------------------------------------------------------------------------

# curl.exe (built into Windows) with -k: the certificate may be self-signed, and needn't name localhost.
$healthy = $false
$deadline = (Get-Date).AddSeconds(90)
while (-not $healthy -and (Get-Date) -lt $deadline) {
    $healthy = (curl.exe -sk --max-time 5 "https://localhost:$port/api/health") -match '"ok"'
    if (-not $healthy) { Start-Sleep -Seconds 2 }
}
if (-not $healthy) { throw "The service started but doesn't answer on https://localhost:$port/. Look in the Application event log under '$eventSource'." }

# The deep check opens a PowerShell session on the WDS server as the service would, and asks WDS.
$answer = (curl.exe -sk --max-time 120 "https://localhost:$port/api/health?deep=true") | Out-String
$check = try { $answer | ConvertFrom-Json } catch { $null }
if (-not $check -or $check.status -ne 'ok') {
    $reason = if ($check -and $check.error) { $check.error } else { $answer.Trim() }
    $hint = if ($wds['Mode'] -eq 'Remote') {
        "Check that the account the console connects as is an administrator on $($wds['ComputerName']), and that WinRM accepts it " +
        "(for a server outside the domain or named by IP address, add -TrustWdsServer, and give -Credential)."
    } else { 'Check that the WDS role and its PowerShell module are installed.' }
    throw "The console is running but can't manage WDS: $reason $hint"
}

$url = "https://$($env:COMPUTERNAME.ToLowerInvariant()):$port/"
Write-Host ''
Write-Host "WDS Console $($check.version) is running and manages WDS on $($check.server) ($($wds['Mode']) mode)."
Write-Host "  Address:    $url"
Write-Host "  Sign-in:    $($allowed -join ', ')"
Write-Host "  Settings:   $settingsPath"
if ($firstInstall) {
    Write-Host ''
    Write-Host 'Browsers will warn about the self-signed certificate until it is trusted; see the README.'
}
