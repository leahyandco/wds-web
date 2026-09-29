# Applies a settings change as a sequence of WDSUTIL commands, stopping at the first that fails. The
# web service builds and validates the commands; this only runs /Set-Server and /Set-TransportServer.
param([Parameter(Mandatory)] [object[]] $Commands)
$ErrorActionPreference = 'Stop'

$applied = @()
foreach ($command in $Commands) {
    $arguments = [string[]]@($command)
    if ($arguments.Count -lt 2 -or $arguments[0] -notin '/Set-Server', '/Set-TransportServer') {
        throw "Refusing to run wdsutil $($arguments -join ' '): only /Set-Server and /Set-TransportServer are allowed."
    }
    $result = Invoke-WdsUtil -Arguments $arguments
    # Keep WDSUTIL's own message, minus its banner.
    $message = (($result.Output -split "`n") | Where-Object { $_.Trim() -and $_ -notmatch 'Management Utility|Microsoft Corporation' }) -join ' '
    if ($result.ExitCode -ne 0) {
        throw "wdsutil $($arguments -join ' ') failed (exit code $($result.ExitCode)): $message"
    }
    $applied += [ordered]@{ command = "wdsutil $($arguments -join ' ')"; message = $message }
}

ConvertTo-WdsJson ([ordered]@{ applied = $applied })
