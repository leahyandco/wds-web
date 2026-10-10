# Windows 11 boot images

A boot image made from Windows 11 installation media (its `sources\boot.wim`) PXE boots, starts
Windows Setup, and then stops where the WDS client should be: Setup says that WDS client
functionality is "being partly deprecated", and the PC restarts when you press OK. Starting
Setup's older pages instead (`sources\setup.exe` in the image) doesn't help: they show a
**Deprecation Notice** page whose only button is **Reboot**.

This is by design. Microsoft no longer lets a Windows 11 `boot.wim` run Setup in WDS mode, and
there's no setting to turn it off. The check is in Setup itself, so it applies to every Windows 11
boot image, 24H2 and 25H2 (10.0.26100) and 26H1 (10.0.28000) included; see
[WDS boot.wim support](https://learn.microsoft.com/windows/deployment/wds-boot-support). WDS
itself still PXE boots clients, and custom boot images, such as MDT's or a WinPE built with the
Windows ADK, aren't affected. Neither is Setup started from a network share. The console warns you when
you choose one of these images to import.

## Use a Windows 10 boot image

Windows 10's Setup has no such check, and its WDS client installs Windows 11 install images like
any other:

1. Import `sources\boot.wim` from Windows 10 installation media (22H2 is the last) as the boot image.
   On the Boot images page, Windows 10's versions start 10.0.1, and Windows 11's are 10.0.22000 or
   later.
2. Import Windows 11's `sources\install.wim` (or `install.esd`) as an install image, as usual.
3. If new hardware needs network or storage drivers that Windows 10's WinPE doesn't have, add them
   on the **Drivers** page: choose the packages, then **Add to boot image**.

Give the boot image a name that says what it's for, such as "Windows Setup (Windows 11)". Clients
see the name in the boot menu, not the WinPE version.

## Keep Windows 11's WinPE, with Windows 10's Setup

For hardware that Windows 10's WinPE can't start, or whose disks it can't see even with drivers added,
there's a middle way that Microsoft doesn't support. A boot image is WinPE (the kernel, drivers and
networking) plus Setup (`setup.exe` and the `sources` folder), and only Setup has the check. So keep
Windows 11's WinPE and give it Windows 10's Setup, which brings its own WDS client. This has been tried
with Windows 11 26H1's WinPE (10.0.28000): the WDS client starts and asks for its sign-in as usual.
Check a full install on your own hardware before relying on it, and build it again for each new Windows
release.

In Windows PowerShell as an administrator, where image 2 of each `boot.wim` is Windows Setup:

```powershell
# Copies of each media's sources\boot.wim
$new = 'C:\Work\boot-win11.wim'
$old = 'C:\Work\boot-win10.wim'
New-Item -ItemType Directory C:\Work\new, C:\Work\old | Out-Null
Mount-WindowsImage -ImagePath $new -Index 2 -Path C:\Work\new | Out-Null
Mount-WindowsImage -ImagePath $old -Index 2 -Path C:\Work\old -ReadOnly | Out-Null

# Some of Setup's files belong to TrustedInstaller.
takeown /f C:\Work\new\sources /r /d y | Out-Null
icacls C:\Work\new\sources /grant Administrators:F /t /c /q | Out-Null
Remove-Item C:\Work\new\sources, C:\Work\new\setup.exe -Recurse -Force
Copy-Item C:\Work\old\sources C:\Work\new\sources -Recurse
Copy-Item C:\Work\old\setup.exe C:\Work\new\setup.exe

Dismount-WindowsImage -Path C:\Work\old -Discard | Out-Null
Dismount-WindowsImage -Path C:\Work\new -Save | Out-Null
```

Then import `boot-win11.wim` as a boot image, with a name that says what it is. The console can't see
inside the image, so it still shows its warning about Windows 11's Setup; carry on past it.

## Other options

- **Setup from a network share.** Boot a custom WinPE that connects to a share holding Windows 11's
  installation files and runs `setup.exe` from it. Microsoft lists this as unaffected.
- **A deployment tool with its own boot image**, such as MDT or Configuration Manager, PXE booted
  through WDS.
