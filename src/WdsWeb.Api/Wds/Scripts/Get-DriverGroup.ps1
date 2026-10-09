# One driver group and its filters, as WDSUTIL reports them, for the web service to parse: changing a
# group's filters needs the ones it has now.
param([Parameter(Mandatory)] [string] $Name)
$ErrorActionPreference = 'Stop'

$group = Invoke-WdsUtil -Arguments '/Get-DriverGroup', "/DriverGroup:$Name", '/Show:Filters'
if ($group.ExitCode -ne 0) {
    $reason = if ($group.Output -match 'Error Description:\s*(.+)') { $Matches[1].Trim() } else { $group.Output }
    throw "Couldn't read driver group ${Name}: $reason"
}

ConvertTo-WdsJson ([ordered]@{ report = $group.Output })
