# Prestaged devices, and the pending-device requests (pending, approved and rejected). Each half is
# queried separately so one failing doesn't hide the other.
$ErrorActionPreference = 'Stop'
Assert-WdsModule

$result = [ordered]@{ prestaged = @(); autoAdd = @(); pendingPolicyEnabled = $true; errors = @() }
try {
    $result.prestaged = @(Get-WdsClient | ForEach-Object { ConvertTo-WdsObject $_ })
} catch {
    $result.errors += "Prestaged devices: $($_.Exception.Message)"
}
try {
    $result.autoAdd = @(Get-WdsClient -PendingClientStatus Any | ForEach-Object { ConvertTo-WdsObject $_ })
} catch {
    # While the pending-device policy is off WDS keeps no requests, and says so with this error.
    if ($_.FullyQualifiedErrorId -like '0xC1050100,*') {
        $result.pendingPolicyEnabled = $false
    } else {
        $result.errors += "Pending device requests: $($_.Exception.Message)"
    }
}

ConvertTo-WdsJson $result
