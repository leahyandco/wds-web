# Prestaged devices, and the auto-add queue (pending, approved and rejected requests). Each half is
# queried separately so one failing doesn't hide the other.
$ErrorActionPreference = 'Stop'
Assert-WdsModule

$result = [ordered]@{ prestaged = @(); autoAdd = @(); errors = @() }
try {
    $result.prestaged = @(Get-WdsClient | ForEach-Object { ConvertTo-WdsObject $_ })
} catch {
    $result.errors += "Prestaged devices: $($_.Exception.Message)"
}
try {
    $result.autoAdd = @(Get-WdsClient -PendingClientStatus Any | ForEach-Object { ConvertTo-WdsObject $_ })
} catch {
    $result.errors += "Auto-add requests: $($_.Exception.Message)"
}

ConvertTo-WdsJson $result
