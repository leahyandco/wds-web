# Windows 11 boot images

A boot image made from Windows 11 installation media (its `sources\boot.wim`) PXE boots, starts
Windows Setup, and then stops where the WDS client should be: Setup says that WDS client
functionality is "being partly deprecated", and the PC restarts when you press OK. Starting
Setup's older pages instead (`sources\setup.exe` in the image) doesn't help: they show a
**Deprecation Notice** page whose only button is **Reboot**.

This is by design. Microsoft no longer lets a Windows 11 `boot.wim` run Setup in WDS mode, and
there's no setting to turn it off; see
[WDS boot.wim support](https://learn.microsoft.com/windows/deployment/wds-boot-support). WDS
itself still PXE boots clients, and custom boot images, such as MDT's or a WinPE built with the
Windows ADK, aren't affected. Neither is Setup started from a network share.

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

## Other options

- **Setup from a network share.** Boot a custom WinPE that connects to a share holding Windows 11's
  installation files and runs `setup.exe` from it. Microsoft lists this as unaffected.
- **A deployment tool with its own boot image**, such as MDT or Configuration Manager, PXE booted
  through WDS.
