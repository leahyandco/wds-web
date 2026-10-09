# Writes driver packages from the WDS driver store into a boot image (WinPE), one at a time: WDS mounts
# the image, adds the driver and saves the image for each, which takes a while, and it can't take a
# driver out again. Progress goes to the progress records, and each package that can't be added to a
# warning, which the web service shows as the job runs.
param(
    [Parameter(Mandatory)] [string] $ImageName,
    [Parameter(Mandatory)] [ValidateSet('x86', 'x64', 'arm', 'arm64')] [string] $Architecture,
    [string] $FileName,
    [Parameter(Mandatory)] [string[]] $PackageIds
)
$ErrorActionPreference = 'Stop'
$InformationPreference = 'Continue'

$total = $PackageIds.Count
Write-Information "Adding $total driver package$(if ($total -ne 1) { 's' }) to $ImageName ($Architecture). WDS saves the boot image after each, which takes a minute or two."
$added = [Collections.Generic.List[string]]::new()
$failed = [Collections.Generic.List[object]]::new()
for ($i = 0; $i -lt $total; $i++) {
    $id = $PackageIds[$i]
    Write-Progress -Activity "Adding drivers to $ImageName ($($i + 1) of $total)" -Status $id -PercentComplete ([int](100 * $i / $total))
    # WDSUTIL reads these in order: /Filename only counts straight after /Architecture.
    $arguments = @('/Add-ImageDriverPackage', "/Image:$ImageName", '/ImageType:Boot', "/Architecture:$Architecture")
    if ($FileName) { $arguments += "/Filename:$FileName" }
    $arguments += "/PackageId:$id"
    $result = Invoke-WdsUtil -Arguments $arguments
    if ($result.ExitCode -eq 0) {
        $added.Add($id)
    } else {
        $reason = if ($result.Output -match 'Error Description:\s*(.+)') { $Matches[1].Trim() } else { "exit code $($result.ExitCode)" }
        Write-Warning "${id}: $reason"
        $failed.Add([ordered]@{ id = $id; reason = $reason })
    }
}
Write-Progress -Activity "Adding drivers to $ImageName" -Completed

if ($added.Count -eq 0) { throw "None of the $total driver packages could be added to ${ImageName}. The first one: $($failed[0].reason)" }
$summary = "Added $($added.Count) driver package$(if ($added.Count -ne 1) { 's' }) to $ImageName"
if ($failed.Count -gt 0) { $summary += "; $($failed.Count) couldn't be added" }
Write-Information $summary

ConvertTo-WdsJson ([ordered]@{ summary = $summary; added = @($added); failed = @($failed); image = $ImageName })
