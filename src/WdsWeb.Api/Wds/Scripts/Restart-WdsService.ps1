# Restarts the WDS service, which interrupts any PXE boots and TFTP downloads in progress.
$ErrorActionPreference = 'Stop'

Restart-Service -Name WDSServer -Force
$service = Get-Service -Name WDSServer
ConvertTo-WdsJson ([ordered]@{ status = $service.Status.ToString() })
