<#
.SYNOPSIS
Builds the release package: artifacts\WdsWeb-<version>-win-x64.zip.

.DESCRIPTION
Builds the frontend, publishes a self-contained build (so the target needs no .NET runtime) and puts
it in a zip with the installer, its example settings and the documentation. Extract the zip on the
machine that will run the console and run Install-WdsWeb.ps1 there.

Needs the .NET 10 SDK and Node.js 22 or later, with the frontend's packages installed (npm ci --prefix web).

.PARAMETER Output
The folder to write the package to. artifacts by default.
#>
[CmdletBinding()]
param([string] $Output)
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
if (-not $Output) { $Output = Join-Path $repo 'artifacts' }

# Judge a build tool by its exit code. Tools like Vite print warnings to stderr, which Windows
# PowerShell would otherwise turn into a terminating error under $ErrorActionPreference = 'Stop'.
function Invoke-Tool([string] $What, [scriptblock] $Command) {
    $ErrorActionPreference = 'Continue'
    & $Command 2>&1 | ForEach-Object { Write-Host "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

$version = ([xml](Get-Content -LiteralPath (Join-Path $repo 'Directory.Build.props') -Raw)).Project.PropertyGroup.Version
$name = "WdsWeb-$version-win-x64"
$staging = Join-Path $Output $name
$package = Join-Path $Output "$name.zip"

Write-Host 'Building the frontend...'
Invoke-Tool 'The frontend build' { npm run build --prefix (Join-Path $repo 'web') }

Write-Host 'Publishing a self-contained build...'
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
Invoke-Tool 'dotnet publish' {
    dotnet publish (Join-Path $repo 'src\WdsWeb.Api') -c Release -r win-x64 --self-contained true -o (Join-Path $staging 'app') -p:DebugType=none
}

Write-Host 'Packaging...'
# The PowerShell SDK brings module manifests for Linux and macOS too; this build only runs on Windows.
$unix = Join-Path $staging 'app\runtimes\unix'
if (Test-Path -LiteralPath $unix) { Remove-Item -LiteralPath $unix -Recurse -Force }
Copy-Item -Path (Join-Path $repo 'installer\*') -Destination $staging
Copy-Item -LiteralPath (Join-Path $repo 'docs') -Destination $staging -Recurse
foreach ($file in 'README.md', 'LICENSE') {
    $path = Join-Path $repo $file
    if (Test-Path -LiteralPath $path) { Copy-Item -LiteralPath $path -Destination $staging }
}

# Entry by entry: Windows PowerShell's ZipFile.CreateFromDirectory writes backslashes into entry
# names, which other unzip tools turn into odd file names.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $package) { Remove-Item -LiteralPath $package -Force }
$root = (Resolve-Path -LiteralPath $staging).Path
$archive = [System.IO.Compression.ZipFile]::Open($package, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -File) {
        # At the top of the zip, not in a folder: Windows' Extract All already makes one named after
        # the zip, and a second inside it puts the installer a folder deeper than people look.
        $entry = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal)
    }
} finally {
    $archive.Dispose()
}
Write-Host "Built $package ($([math]::Round((Get-Item -LiteralPath $package).Length / 1MB)) MB)"
$package
