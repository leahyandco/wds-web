# Runs a sequence of WDSUTIL commands, stopping at the first that fails. The web service builds and
# validates the commands; this only runs the verbs the console uses to change settings and devices.
param([Parameter(Mandatory)] [object[]] $Commands)
$ErrorActionPreference = 'Stop'

$allowed = '/Set-Server', '/Set-TransportServer', '/Add-Device', '/Set-Device', '/Remove-Device', '/Approve-AutoAddDevices', '/Reject-AutoAddDevices',
    '/Delete-AutoAddDevices'

$applied = @()
foreach ($command in $Commands) {
    $arguments = [string[]]@($command)
    if ($arguments.Count -lt 2 -or $arguments[0] -notin $allowed) {
        throw "Refusing to run wdsutil $($arguments -join ' '): only $($allowed -join ', ') are allowed."
    }
    $result = Invoke-WdsUtil -Arguments $arguments
    # Keep WDSUTIL's own message, minus its banner.
    $message = (($result.Output -split "`n") | Where-Object { $_.Trim() -and $_ -notmatch 'Management Utility|Microsoft Corporation' }) -join ' '
    if ($result.ExitCode -ne 0) {
        # Its error says what went wrong after "Error Description:", e.g. that the device ID is taken.
        $reason = if ($message -match 'Error Description:\s*(.+)$') { $Matches[1].Trim() } else { "exit code $($result.ExitCode): $message" }
        throw "wdsutil $($arguments -join ' ') failed: $reason"
    }
    $applied += [ordered]@{ command = "wdsutil $($arguments -join ' ')"; message = $message }
}

ConvertTo-WdsJson ([ordered]@{ applied = $applied })
