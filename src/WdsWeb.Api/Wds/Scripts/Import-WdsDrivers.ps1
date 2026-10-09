# Adds driver packages to the WDS driver store from a .zip or .cab of drivers, a folder of them, or a
# single .inf on this server: each .inf found becomes a package, optionally in a driver group (created
# if asked). WDS keeps one copy of a package however often it's added, so the store is counted before
# and after to tell new packages from ones it already had. Progress goes to the information stream and
# progress records, and each .inf that can't be added to a warning, which the web service shows as the
# import runs.
param(
    [Parameter(Mandatory)] [string] $Path,
    [string] $DriverGroup,
    [switch] $CreateGroup,
    [ValidateSet('', 'x86', 'x64', 'arm', 'arm64')] [string] $Architecture = '',
    [Parameter(Mandatory)] [string] $TempFolder
)
$ErrorActionPreference = 'Stop'
$InformationPreference = 'Continue'

# WDSUTIL explains a failure after "Error Description:".
function Get-WdsUtilReason([string] $Output) {
    if ($Output -match 'Error Description:\s*(.+)') { $Matches[1].Trim() } else { ($Output -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1) }
}

function Get-DriverPackageCount {
    $report = Invoke-WdsUtil -Arguments '/Get-AllDriverPackages'
    if ($report.ExitCode -eq 0 -and $report.Output -match 'Total number of driver packages:\s*(\d+)') { [int]$Matches[1] } else { $null }
}

try {
    $name = Split-Path $Path -Leaf
    if (Test-Path -LiteralPath $Path -PathType Container) {
        $root = $Path
    } elseif (Test-Path -LiteralPath $Path -PathType Leaf) {
        switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
            '.zip' {
                Write-Information "Extracting $name"
                Expand-Archive -LiteralPath $Path -DestinationPath $TempFolder -Force
                $root = $TempFolder
            }
            '.cab' {
                Write-Information "Extracting $name"
                New-Item -ItemType Directory -Force -Path $TempFolder | Out-Null
                $expanded = & (Join-Path $env:SystemRoot 'System32\expand.exe') -F:* $Path $TempFolder 2>&1 | Out-String
                if ($LASTEXITCODE -ne 0) { throw "Couldn't extract ${name}: $expanded" }
                $root = $TempFolder
            }
            '.inf' { $root = Split-Path $Path -Parent; $infs = @(Get-Item -LiteralPath $Path) }
            default { throw "Drivers can be added from a .zip or .cab file, a folder or an .inf file, not $name." }
        }
    } else {
        throw "There's nothing at $Path on $env:COMPUTERNAME."
    }
    if (-not $infs) { $infs = @(Get-ChildItem -LiteralPath $root -Filter *.inf -Recurse -File) }
    if ($infs.Count -eq 0) {
        throw "There are no .inf files in $name, so no drivers to add. Drivers that come as an .exe need extracting first."
    }

    if ($DriverGroup) {
        $group = Invoke-WdsUtil -Arguments '/Get-DriverGroup', "/DriverGroup:$DriverGroup"
        if ($group.ExitCode -ne 0) {
            if (-not $CreateGroup) { throw "There's no driver group named $DriverGroup." }
            Write-Information "Creating driver group $DriverGroup"
            $created = Invoke-WdsUtil -Arguments '/Add-DriverGroup', "/DriverGroup:$DriverGroup"
            if ($created.ExitCode -ne 0) { throw "Couldn't create driver group ${DriverGroup}: $(Get-WdsUtilReason $created.Output)" }
        }
    }

    $before = Get-DriverPackageCount
    $total = $infs.Count
    Write-Information "Adding $total driver package$(if ($total -ne 1) { 's' })$(if ($DriverGroup) { " to $DriverGroup" })"
    $added = [Collections.Generic.List[string]]::new()
    $otherArchitecture = [Collections.Generic.List[string]]::new()
    $failed = [Collections.Generic.List[object]]::new()
    $prefix = $root.TrimEnd('\').Length
    for ($i = 0; $i -lt $total; $i++) {
        $inf = $infs[$i]
        $relative = $inf.FullName.Substring([Math]::Min($prefix, $inf.FullName.Length)).TrimStart('\')
        Write-Progress -Activity "Adding driver packages ($($i + 1) of $total)" -Status $relative -PercentComplete ([int](100 * $i / $total))
        $arguments = @('/Add-DriverPackage', "/InfFile:$($inf.FullName)")
        if ($Architecture) { $arguments += "/Architecture:$Architecture" }
        if ($DriverGroup) { $arguments += "/DriverGroup:$DriverGroup" }
        $result = Invoke-WdsUtil -Arguments $arguments
        if ($result.ExitCode -eq 0) {
            $added.Add($relative)
        } elseif ($result.Output -match '0xC103017D') {
            # No drivers for the chosen architecture: skipped, as WDSUTIL /Add-AllDriverPackages does.
            $otherArchitecture.Add($relative)
        } else {
            $reason = Get-WdsUtilReason $result.Output
            Write-Warning "${relative}: $reason"
            $failed.Add([ordered]@{ inf = $relative; reason = $reason })
        }
    }
    Write-Progress -Activity 'Adding driver packages' -Completed

    if ($added.Count -eq 0) {
        if ($failed.Count -gt 0) { throw "None of the $total driver packages could be added. The first one: $($failed[0].reason)" }
        throw "None of the $total .inf files in $name has drivers for $Architecture."
    }
    $after = Get-DriverPackageCount
    $new = if ($null -ne $before -and $null -ne $after) { $after - $before } else { $null }
    $packages = { param($count) "$count driver package$(if ($count -ne 1) { 's' })" }
    $summary = if ($null -eq $new) { "Added $(& $packages $added.Count)" }
        elseif ($new -eq $added.Count) { "Added $(& $packages $new)" }
        elseif ($new -le 0) { "WDS already had $(if ($added.Count -eq 1) { 'the driver package' } else { "all $($added.Count) driver packages" })" }
        else { "Added $(& $packages $new); WDS already had $($added.Count - $new)" }
    if ($DriverGroup) { $summary += ", now in $DriverGroup" }
    if ($otherArchitecture.Count -gt 0) { $summary += "; skipped $($otherArchitecture.Count) with no $Architecture drivers" }
    if ($failed.Count -gt 0) { $summary += "; $($failed.Count) couldn't be added" }
    Write-Information $summary

    ConvertTo-WdsJson ([ordered]@{
        summary = $summary
        found = $total
        new = $new
        added = @($added)
        otherArchitecture = @($otherArchitecture)
        failed = @($failed)
        driverGroup = $(if ($DriverGroup) { $DriverGroup } else { $null })
    })
} finally {
    if (Test-Path -LiteralPath $TempFolder) { Remove-Item -LiteralPath $TempFolder -Recurse -Force -ErrorAction SilentlyContinue }
}
