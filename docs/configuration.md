# Configuration

The console reads its settings from `C:\ProgramData\WdsWeb\settings.json`, which the installer
creates and updates leave alone. Edit it with any text editor, then restart the **WdsWeb** service
(`Restart-Service WdsWeb`). Running `Install-WdsWeb.ps1` again with new parameters changes the
settings it knows about and restarts the service for you.

The file must be plain JSON (no comments), with `\` written as `\\`. A complete example is in
[`settings.example.json`](../installer/settings.example.json), which ships next to the installer.

Settings can also be given as environment variables, which win over the file: use `__` (two
underscores) between levels, such as `Auth__SessionLifetime=04:00:00`. Lists can be one value
separated by semicolons: `Auth__AllowedGroups=CONTOSO\WDS Admins;CONTOSO\Helpdesk`. To read the
settings from another file, point the `WDSWEB_SETTINGS` environment variable at it.

## Wds: the WDS server

| Setting | Default | |
| --- | --- | --- |
| `Mode` | `Local` | `Local` when the console runs on the WDS server. `Remote` to manage the server named in `ComputerName` over WinRM. `Demo` shows a sample server instead, to try the console out; nothing can be changed, and sign-in is off unless `Auth:Enabled` says otherwise. |
| `ComputerName` | | Remote mode: the WDS server's name or address. |
| `CredentialFile` | | Remote mode: the account to connect as. The installer's `-Credential` writes `C:\ProgramData\WdsWeb\credential.json`, encrypted for this machine. A PSCredential saved with `Get-Credential \| Export-Clixml` also works, for the Windows account that saved it. Left out, the console connects as its service account. |
| `UseSsl` | `false` | Connect to WinRM over HTTPS, which needs a WinRM HTTPS listener on the WDS server. |
| `Port` | `5985`, or `5986` with SSL | The WinRM port. |
| `StagingPath` | `C:\WdsWeb\Staging` | A folder on the WDS server for uploads and for temporary files during imports. It must be on a local drive of the WDS server, outside RemoteInstall. |
| `StagingShare` | the server's `C$` share | Remote mode: a share that reaches `StagingPath` from the console's machine, such as `\\wds01\WdsStaging`, for servers whose administrative shares are turned off. |
| `ImageSearchPaths` | `C:\Users\*\Downloads`, `C:\ISO`, `C:\ISOs`, `C:\Images` | Folders on the WDS server whose .iso, .wim and .esd files are offered for import. Wildcards are allowed. |
| `PoolSize` | `3` | How many PowerShell sessions to keep open on the WDS server. |
| `CommandTimeout` | `00:02:00` | How long one WDS command may take. |
| `JobTimeout` | `03:00:00` | How long one import may take. |

## Auth: who can sign in

| Setting | Default | |
| --- | --- | --- |
| `AllowedGroups` | `BUILTIN\Administrators` | Windows groups whose members may sign in, local or domain: `CONTOSO\WDS Admins`. |
| `AllowedUsers` | | Individual accounts that may sign in: `CONTOSO\jdoe`, `jdoe@contoso.com`, or a local account as `CONSOLE01\operator`. |
| `SessionLifetime` | `08:00:00` | How long a sign-in lasts without being used. Each use extends it. |
| `Enabled` | `true` | Whether sign-in is required at all. Turn it off only behind something else that authenticates, as anyone who can reach the console could then change WDS. |

The local Administrators group is allowed only while neither `AllowedGroups` nor `AllowedUsers` is
set; setting either replaces it. Names are looked up by the machine the console runs on. The Server
settings page shows the list, and the Application event log notes any name Windows can't find when the
service starts.

## Https: the console's address

| Setting | Default | |
| --- | --- | --- |
| `Port` | `8443` | The port to listen on, on every address of the machine. |
| `CertificateThumbprint` | the installer's self-signed certificate | A certificate in `Cert:\LocalMachine\My`, with its private key. |

Changing the port by hand also means changing the firewall rule ("WDS Console (HTTPS)"); the
installer's `-Port` does both.

## Logging

The console writes warnings, errors and its audit log (sign-ins and every change, as source
"WDS Console") to the Application event log. The standard .NET `Logging` settings apply, for example
`"Logging": { "LogLevel": { "Default": "Warning" } }`.
