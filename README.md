# WDS Console

A web interface for Windows Deployment Services: boot and install images, devices, server settings
and events. It starts as a console for an existing WDS server and is meant to grow into a deployment
app that uses WDS for PXE.

## How it works

```
Browser ──▶ WdsWeb.Api (ASP.NET Core, .NET 10) ──▶ PowerShell session on the WDS server ──▶ WDS module, WDSUTIL, registry, event logs
```

The WDS PowerShell module only runs in Windows PowerShell 5.1, so the API never calls WDS in-process.
It keeps a small pool of 5.1 sessions on the WDS server and runs the scripts in
`src/WdsWeb.Api/Wds/Scripts` there. Each script takes its inputs as parameters and prints one JSON
document.

- **Local mode** (production): the API runs on the WDS server and starts `powershell.exe` itself.
- **Remote mode** (development): the API connects to the WDS server over WinRM.

Server-wide settings exist only in WDSUTIL, which prints English text; `WdsUtilOutputParser` turns it
into a tree. The driver store comes from WDSUTIL too: `Get-WdsDriverPackage` only returns some
packages.

## Importing images

Boot and install images can be imported from an upload or from an .iso, .wim or .esd already on the
WDS server (the Import button on the image pages).

- **Uploads** go in 8 MB chunks to a staging folder on the WDS server, `C:\WdsWeb\Staging` by
  default (`Wds:StagingPath`), outside RemoteInstall. In Remote mode the API writes there through
  the server's `C$` share with the same credential. A failed chunk is retried, and an unfinished
  upload of the same file carries on where it stopped.
- **Reading** an ISO mounts it read-only for a few seconds and lists the images in
  `sources\boot.wim` and `sources\install.wim`/`.esd`.
- **Imports** run one at a time in the background; the image pages show their progress and log.
  An .esd, or a boot image that isn't the one marked bootable, is exported to a temporary .wim
  first, since WDS can't import those directly.
- **Space**: RemoteInstall and the staging folder are usually on the same drive. An install image
  in a new image group needs about the size of its .wim, because it can't share files with images
  in other groups.

Files are offered from `C:\Users\*\Downloads`, `C:\ISO`, `C:\ISOs` and `C:\Images` on the server
unless `Wds:ImageSearchPaths` says otherwise.

Each image's menu also has **Properties**: its name, description and display order (WDS lists lower
numbers first), and for an install image the unattend file Windows Setup uses when it installs it,
kept under RemoteInstall as `Images\<group>\<image>\Unattend\ImageUnattend.xml`. An unattend file
is checked to be a well-formed Setup answer file before WDS gets it, and the audit log records only
its size, since unattend files often hold passwords.

## Devices

Prestaged devices are known clients: WDS answers them even when it answers only known clients, and
each can have its own PXE prompt, boot image and WDS client unattend file. Prestage one on the
Devices page, or from a PXE boot on the Boot activity page, which fills in the IDs the client
reported. Prefer the SMBIOS GUID where the machine has a real one: a MAC address belongs to the
network adapter, so it follows a shared USB adapter from machine to machine.

When the pending-device policy waits for approval (Server settings → Pending devices), unknown
clients wait at their PXE screen and are listed under "Waiting for approval" to approve or reject.

## Development

Requirements: .NET 10 SDK, Node 22 or later, and a WDS server to point at.

The development settings (`appsettings.Development.json`) connect to `wds01` over WinRM. On the
development machine, once:

```powershell
# As administrator: allow NTLM to a workgroup machine
Set-Item WSMan:\localhost\Client\TrustedHosts -Value 'wds01' -Concatenate -Force

# As the account that runs the API: save an admin credential for the WDS server
New-Item -ItemType Directory -Force "$env:APPDATA\wds-web" | Out-Null
Get-Credential -Message 'WDS server admin account' | Export-Clixml "$env:APPDATA\wds-web\wds01.credential.xml"
```

The credential file is DPAPI-encrypted, so only the account that saved it can read it, on that
machine. It lives outside the repo.

Run the API and the frontend dev server:

```powershell
dotnet run --project src/WdsWeb.Api          # http://localhost:5080
npm run dev --prefix web                      # http://localhost:5173, proxies /api to 5080
```

Use `--launch-profile local` instead to manage WDS on the machine the API runs on.

Tests: `dotnet test WdsWeb.slnx`. Frontend checks: `npm run build --prefix web` and
`npm run lint --prefix web`.

## Installing on the WDS server

```powershell
.\deploy\Deploy-WdsWeb.ps1                 # defaults: -ComputerName wds01 -Port 8443
```

The script builds the frontend (into `src/WdsWeb.Api/wwwroot`), publishes a self-contained build so
the server needs no .NET runtime, and installs it as the **WdsWeb** service on the server, running
as LocalSystem in Local mode. On the first run it also creates a self-signed HTTPS certificate for
the server's names and addresses, `C:\ProgramData\WdsWeb\settings.json` (port and certificate
thumbprint), the "WDS Console" event log source and a firewall rule. Later runs only replace the
program files and restart the service. Every run ends by checking that the service answers and can
manage WDS (`/api/health?deep=true`, which answers only requests from the server itself).

- **Address**: `https://wds01:8443/`. Browsers warn about the self-signed certificate until it's
  trusted; export it from `LocalMachine\My` on the server ("WDS Console") and import it into Trusted
  Root Certification Authorities on the machines that use the console.
- **Sign-in**: Windows accounts on the server, local or domain (`CONTOSO\you`, `you@contoso.com`).
  Only members of the server's local Administrators group get in by default; to allow others, add
  `"Auth": { "AllowedGroups": ["CONTOSO\\WDS Admins"] }` to `settings.json` and restart the service.
  Ten attempts per address per five minutes.
- **Audit**: sign-ins and every change (imports, image actions, settings) go to the server's
  Application event log under the source "WDS Console".
- **Machine settings** in `C:\ProgramData\WdsWeb\settings.json` override `appsettings.json` and survive
  updates. Cookie keys are kept in `C:\ProgramData\WdsWeb\keys`.

In development sign-in is off (`appsettings.Development.json`), since the API only listens on
localhost there.
