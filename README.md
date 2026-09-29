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
into a tree.

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

## Production build

`npm run build --prefix web` writes the frontend into `src/WdsWeb.Api/wwwroot`, and the API serves it
from there, so one process serves everything. Hosting it as a Windows service with authentication
comes later.
