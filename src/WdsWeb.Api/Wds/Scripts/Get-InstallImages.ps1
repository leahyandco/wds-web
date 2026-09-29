# Install image groups and the images in them.
$ErrorActionPreference = 'Stop'
Assert-WdsModule

ConvertTo-WdsJson ([ordered]@{
    groups = @(Get-WdsInstallImageGroup | ForEach-Object { ConvertTo-WdsObject $_ })
    images = @(Get-WdsInstallImage | ForEach-Object { ConvertTo-WdsObject $_ })
})
