# .iso, .wim and .esd files in the given folders on the WDS server (wildcards allowed, searched four
# levels deep), newest first, to offer as import sources.
param([string[]] $Roots)
$ErrorActionPreference = 'Stop'

$found = foreach ($root in $Roots) {
    foreach ($folder in @(Resolve-Path -Path $root -ErrorAction SilentlyContinue)) {
        Get-ChildItem -LiteralPath $folder.ProviderPath -Recurse -Depth 4 -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -in '.iso', '.wim', '.esd' }
    }
}

ConvertTo-WdsJson @($found | Sort-Object -Property FullName -Unique | Sort-Object -Property LastWriteTimeUtc -Descending |
    Select-Object -First 500 | ForEach-Object {
        [ordered]@{ path = $_.FullName; size = $_.Length; modified = $_.LastWriteTimeUtc.ToString('o') }
    })
