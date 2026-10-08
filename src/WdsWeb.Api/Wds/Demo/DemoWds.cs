using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace WdsWeb.Api.Wds.Demo;

/// <summary>
/// Answers the WDS scripts with sample data, for Wds:Mode Demo: the console runs without a WDS server,
/// showing a made-up one (WDS01 in contoso.com), to try it out and to take screenshots. Times are
/// relative to now, so boots look recent. Nothing can be changed.
/// </summary>
public static class DemoWds
{
    public const string ServerName = "WDS01";
    public const string Domain = "contoso.com";
    public const string NothingChanges = "This is the demo: its WDS server is a sample, so nothing can be changed.";

    private static readonly CultureInfo English = CultureInfo.GetCultureInfo("en-US");

    public static JsonElement Run(string script, IReadOnlyDictionary<string, object?>? parameters, DateTimeOffset now) => script switch
    {
        "Get-TargetInfo" => Json(Target(now)),
        "Get-ServerConfig" => Json(ServerConfig()),
        "Get-BootImages" => Json(BootImages(now)),
        "Get-InstallImages" => Json(InstallImages(now)),
        "Get-Devices" => Json(Devices()),
        "Get-DriverPackages" => Json(new { packages = DriverPackagesReport(now), groups = DriverGroupsReport(now) }),
        "Get-BootActivity" => Json(Activity(now)),
        "Get-Events" => Json(Events(now, parameters)),
        "Find-ImageFiles" => Json(ImageFiles(now)),
        "Get-ImageFileInfo" => Json(ImageFileInfo(parameters?.GetValueOrDefault("Path") as string ?? @"C:\ISO\Win11_25H2_English_x64.iso")),
        "Get-WdsImageUnattend" => Json(Unattend(parameters?.GetValueOrDefault("Name") as string, parameters?.GetValueOrDefault("ImageGroup") as string)),
        _ => throw new InvalidRequestException(NothingChanges),
    };

    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);

    // ---- The server ----------------------------------------------------------------------------------

    private static object Target(DateTimeOffset now) => new
    {
        computerName = ServerName,
        osCaption = "Microsoft Windows Server 2025 Standard",
        osVersion = "10.0.26100",
        osBuild = "26100",
        lastBootTime = Iso(now.AddDays(-9).AddHours(-3)),
        partOfDomain = true,
        domain = Domain,
        psVersion = "5.1.26100.1",
        features = new[]
        {
            new { name = "WDS", displayName = "Windows Deployment Services", installed = true },
            new { name = "WDS-Deployment", displayName = "Deployment Server", installed = true },
            new { name = "WDS-Transport", displayName = "Transport Server", installed = true },
            new { name = "WDS-AdminPack", displayName = "Windows Deployment Services Tools", installed = true },
        },
        wdsService = new { status = "Running", startType = "Automatic" },
        wdsModule = "1.0.0.0",
    };

    private static object ServerConfig() => new
    {
        wdsUtilExitCode = 0,
        wdsUtilOutput = DemoServerReport(),
        remoteInstall = new { path = @"C:\RemoteInstall", totalBytes = 511_101_399_040L, freeBytes = 318_489_317_376L },
        allowHandsFreeFunctionality = (int?)null,
        bootPrograms = new[]
        {
            @"Boot\arm64\bootmgfw.efi", @"Boot\arm64\wdsmgfw.efi",
            @"Boot\x64\abortpxe.com", @"Boot\x64\bootmgfw.efi", @"Boot\x64\pxeboot.com", @"Boot\x64\pxeboot.n12", @"Boot\x64\wdsmgfw.efi", @"Boot\x64\wdsnbp.com",
            @"Boot\x86\abortpxe.com", @"Boot\x86\pxeboot.com", @"Boot\x86\pxeboot.n12", @"Boot\x86\wdsnbp.com",
        },
        interfaces = new[] { new { name = "Ethernet", ipAddress = "192.0.2.10", macAddress = "00-00-5E-00-53-10", status = "Up" } },
    };

    /// <summary>
    /// A real server's report, with WDS client logging and the pending-device policy on, to match the
    /// installs and the requests the demo shows.
    /// </summary>
    private static string DemoServerReport()
    {
        var report = DemoResources.Text("get-server-config.txt");
        report = System.Text.RegularExpressions.Regex.Replace(report, @"(Logging policy:\r?\n\s+Enabled:) No", "$1 Yes");
        report = System.Text.RegularExpressions.Regex.Replace(report, @"(Pending Device Policy:\r?\n\s+Policy:) Disabled", "$1 AdminApproval");
        return report;
    }

    // ---- Images --------------------------------------------------------------------------------------

    private static object[] BootImages(DateTimeOffset now) =>
    [
        BootImage("Windows 11 Setup (x64)", "Windows 11 25H2 Setup", "X64", "boot-win11-x64.wim", "10.0.26100.6584", 3_310_436_352, true, 100, now.AddDays(-21)),
        BootImage("Windows Server 2025 Setup (x64)", "Windows Server 2025 Setup", "X64", "boot-ws2025-x64.wim", "10.0.26100.1742", 3_228_901_376, true, 200, now.AddDays(-48)),
        BootImage("WinPE Tools (x64)", "Diagnostics, disk and imaging tools", "X64", "winpe-tools-x64.wim", "10.0.26100.1", 1_486_635_008, true, 300, now.AddDays(-63)),
        BootImage("Windows 11 Setup (ARM64)", "Windows 11 25H2 Setup for ARM64", "Arm64", "boot-win11-arm64.wim", "10.0.26100.6584", 3_402_092_544, true, 400, now.AddDays(-21)),
        BootImage("Windows 10 Setup (x64)", "Kept for older hardware", "X64", "boot-win10-x64.wim", "10.0.19041.5965", 2_617_245_696, false, 500, now.AddDays(-310)),
    ];

    private static Dictionary<string, object?> BootImage(
        string name, string description, string architecture, string fileName, string version, long size, bool enabled, int order, DateTimeOffset modified) => new()
    {
        ["Name"] = name,
        ["Description"] = description,
        ["Architecture"] = architecture,
        ["FileName"] = fileName,
        ["Version"] = version,
        ["Size"] = size,
        ["Enabled"] = enabled,
        ["DisplayOrder"] = order,
        ["PriorityDefaulted"] = false,
        ["DefaultLanguage"] = "en-US",
        ["Languages"] = new[] { "en-US" },
        ["ProductName"] = "Microsoft® Windows® Operating System",
        ["SupportsDriverInjection"] = true,
        ["SystemRoot"] = "WINDOWS",
        ["Id"] = Id($"boot:{fileName}").ToString("B").ToUpperInvariant(),
        ["CreationTime"] = Iso(modified.AddHours(-2)),
        ["LastModificationTime"] = Iso(modified),
    };

    private static object InstallImages(DateTimeOffset now) => new
    {
        groups = new[]
        {
            new { Name = "Windows 11", ImageFormat = "Wim" },
            new { Name = "Windows Server", ImageFormat = "Wim" },
            new { Name = "Windows 10", ImageFormat = "Wim" },
        },
        images = new object[]
        {
            InstallImage("Windows 11 Pro", "Windows 11 Pro 25H2", "Windows 11", "install-win11-pro.wim", "10.0.26200.6584", 19_461_103_616, true, true, 100, now.AddDays(-21)),
            InstallImage("Windows 11 Enterprise", "Windows 11 Enterprise 25H2", "Windows 11", "install-win11-enterprise.wim", "10.0.26200.6584", 19_533_942_784, true, true, 200, now.AddDays(-21)),
            InstallImage("Windows 11 Education", "Windows 11 Education 25H2", "Windows 11", "install-win11-education.wim", "10.0.26200.6584", 19_533_942_784, true, false, 300, now.AddDays(-21)),
            InstallImage("Windows Server 2025 Standard (Desktop Experience)", "Windows Server 2025 Standard with the desktop", "Windows Server", "install-ws2025-standard.wim", "10.0.26100.1742", 20_307_866_845, true, false, 100, now.AddDays(-48)),
            InstallImage("Windows Server 2025 Datacenter (Desktop Experience)", "Windows Server 2025 Datacenter with the desktop", "Windows Server", "install-ws2025-datacenter.wim", "10.0.26100.1742", 20_311_027_712, true, false, 200, now.AddDays(-48)),
            InstallImage("Windows 10 Pro", "Windows 10 Pro 22H2", "Windows 10", "install-win10-pro.wim", "10.0.19045.6216", 15_946_088_448, false, false, 100, now.AddDays(-310)),
        },
    };

    private static Dictionary<string, object?> InstallImage(
        string name, string description, string group, string fileName, string version, long size, bool enabled, bool unattend, int order, DateTimeOffset modified) => new()
    {
        ["Name"] = name,
        ["Description"] = description,
        ["ImageGroup"] = group,
        ["Architecture"] = "X64",
        ["FileName"] = fileName,
        ["Version"] = version,
        ["Size"] = size,
        ["Enabled"] = enabled,
        ["UnattendFilePresent"] = unattend,
        ["DisplayOrder"] = order,
        ["PriorityDefaulted"] = false,
        ["DefaultLanguage"] = "en-US",
        ["Languages"] = new[] { "en-US" },
        ["ProductName"] = "Microsoft® Windows® Operating System",
        ["ProductFamily"] = group == "Windows Server" ? "ServerNT" : "WinNT",
        ["Staged"] = true,
        ["Id"] = Id($"install:{fileName}").ToString("B").ToUpperInvariant(),
        ["CreationTime"] = Iso(modified.AddHours(-1)),
        ["LastModificationTime"] = Iso(modified),
    };

    private static object Unattend(string? name, string? group)
    {
        var path = $@"C:\RemoteInstall\Images\{group ?? "Windows 11"}\{Slug(name ?? "image")}\Unattend\ImageUnattend.xml";
        var present = name is "Windows 11 Pro" or "Windows 11 Enterprise";
        return new { present, path, content = present ? SampleUnattend : null };
    }

    private const string SampleUnattend = """
        <?xml version="1.0" encoding="utf-8"?>
        <unattend xmlns="urn:schemas-microsoft-com:unattend">
          <settings pass="oobeSystem">
            <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
              <InputLocale>en-US</InputLocale>
              <SystemLocale>en-US</SystemLocale>
              <UILanguage>en-US</UILanguage>
              <UserLocale>en-US</UserLocale>
            </component>
            <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
              <TimeZone>Pacific Standard Time</TimeZone>
              <OOBE>
                <HideEULAPage>true</HideEULAPage>
                <ProtectYourPC>3</ProtectYourPC>
              </OOBE>
            </component>
          </settings>
        </unattend>
        """;

    private static object[] ImageFiles(DateTimeOffset now) =>
    [
        new { path = @"C:\ISO\Win11_25H2_English_x64.iso", size = 7_867_854_848L, modified = Iso(now.AddDays(-22)) },
        new { path = @"C:\ISO\Windows_Server_2025_x64.iso", size = 5_510_529_024L, modified = Iso(now.AddDays(-49)) },
        new { path = @"C:\Images\winpe-tools-x64.wim", size = 512_458_752L, modified = Iso(now.AddDays(-64)) },
    ];

    private static object ImageFileInfo(string path)
    {
        var server = path.Contains("Server", StringComparison.OrdinalIgnoreCase);
        var version = server ? "10.0.26100.1742" : "10.0.26200.6584";
        var editions = server
            ? new[] { ("Windows Server 2025 Standard", "ServerStandardCore"), ("Windows Server 2025 Standard (Desktop Experience)", "ServerStandard"), ("Windows Server 2025 Datacenter", "ServerDatacenterCore"), ("Windows Server 2025 Datacenter (Desktop Experience)", "ServerDatacenter") }
            : new[] { ("Windows 11 Home", "Core"), ("Windows 11 Education", "Education"), ("Windows 11 Pro", "Professional"), ("Windows 11 Enterprise", "Enterprise") };
        return new
        {
            path,
            name = Path.GetFileName(path),
            size = 7_867_854_848L,
            format = "iso",
            label = server ? "SSS_X64FRE_EN-US_DV9" : "CCCOMA_X64FRE_EN-US_DV9",
            warning = (string?)null,
            files = new object[]
            {
                new
                {
                    innerPath = @"sources\boot.wim", role = "boot", format = "wim", size = 698_735_697L,
                    images = new[]
                    {
                        ImageEntry(1, "Microsoft Windows PE (x64)", 2_932_409_163, version, "WindowsPE", "WindowsPE", false),
                        ImageEntry(2, "Microsoft Windows Setup (x64)", 2_986_906_685, version, "WindowsPE", "WindowsPE", true),
                    },
                },
                new
                {
                    innerPath = @"sources\install.wim", role = "install", format = "wim", size = 6_421_303_296L,
                    images = editions.Select((edition, i) => ImageEntry(i + 1, edition.Item1, 19_400_000_000L + i * 61_000_000L, version, edition.Item2, server ? "Server" : "Client", false)).ToArray(),
                },
            },
        };
    }

    private static object ImageEntry(int index, string name, long size, string version, string editionId, string installationType, bool bootable) => new
    {
        index, name, description = name, size, architecture = "x64", version, editionId, installationType,
        languages = new[] { "en-US" }, bootable, modified = (string?)null,
    };

    // ---- Devices -------------------------------------------------------------------------------------

    private static object Devices() => new
    {
        prestaged = new object[]
        {
            Device("LAB-PC-01", "00-00-5E-00-53-11", "Lab", "NoPrompt", @"Boot\x64\Images\boot-win11-x64.wim", @"WdsClientUnattend\lab-x64.xml"),
            Device("LAB-PC-02", "00-00-5E-00-53-12", "Lab", "NoPrompt", @"Boot\x64\Images\boot-win11-x64.wim", @"WdsClientUnattend\lab-x64.xml"),
            Device("LAB-PC-03", "00-00-5E-00-53-13", "Lab", "NoPrompt", @"Boot\x64\Images\boot-win11-x64.wim", @"WdsClientUnattend\lab-x64.xml"),
            Device("KIOSK-01", "{E8A3EFAC-201F-4E69-953E-B2DAA1E8B1B6}", "Kiosks", 0, null, null),
            Device("TRAINING-01", "00-00-5E-00-53-21", "Training rooms", "OptIn", null, @"WdsClientUnattend\training.xml"),
            Device("SRV-BUILD-01", "00-00-5E-00-53-31", "Servers", "OptOut", @"Boot\x64\Images\boot-ws2025-x64.wim", null),
        },
        autoAdd = new object[]
        {
            new Dictionary<string, object?> { ["RequestId"] = 21, ["Status"] = "Pending", ["DeviceName"] = null, ["DeviceID"] = "{0B6F1E2A-4C1D-4E3B-9A57-1F2E3D4C5B6A}", ["Architecture"] = "X64", ["BootImagePath"] = null },
            new Dictionary<string, object?> { ["RequestId"] = 20, ["Status"] = "Approved", ["DeviceName"] = "LAB-PC-07", ["DeviceID"] = "00-00-5E-00-53-17", ["Architecture"] = "X64", ["BootImagePath"] = @"Boot\x64\Images\boot-win11-x64.wim" },
            new Dictionary<string, object?> { ["RequestId"] = 19, ["Status"] = "Denied", ["DeviceName"] = null, ["DeviceID"] = "00-00-5E-00-53-90", ["Architecture"] = "X86", ["BootImagePath"] = null },
        },
        pendingPolicyEnabled = true,
        errors = Array.Empty<string>(),
    };

    private static Dictionary<string, object?> Device(string name, string id, string group, object prompt, string? bootImage, string? unattend) => new()
    {
        ["DeviceName"] = name,
        ["DeviceID"] = id,
        ["Group"] = group,
        ["PxePromptPolicy"] = prompt,
        ["BootImagePath"] = bootImage,
        ["WdsClientUnattend"] = unattend,
        ["JoinDomain"] = true,
        ["JoinRights"] = "JoinOnly",
    };

    // ---- Drivers, as WDSUTIL prints them -------------------------------------------------------------

    private sealed record Driver(string Inf, string Architecture, string Class, string ClassGuid, string Provider, string Version, DateOnly Date, int AddedDaysAgo);

    private const string NetClass = "{4D36E972-E325-11CE-BFC1-08002BE10318}";
    private const string StorageClass = "{4D36E97B-E325-11CE-BFC1-08002BE10318}";
    private const string SystemClass = "{4D36E97D-E325-11CE-BFC1-08002BE10318}";
    private const string DisplayClass = "{4D36E968-E325-11CE-BFC1-08002BE10318}";
    private const string MediaClass = "{4D36E96C-E325-11CE-BFC1-08002BE10318}";
    private const string HidClass = "{745A17A0-74D3-11D0-B6FE-00A0C90F57DA}";
    private const string BluetoothClass = "{E0CBF06C-CD8B-4647-BB8A-263B43F0F974}";

    private static readonly Driver[] Drivers =
    [
        new("e1d68x64", "x64", "Net", NetClass, "Intel", "12.19.2.45", new(2024, 6, 20), 40),
        new("rt640x64", "x64", "Net", NetClass, "Realtek", "10.68.815.2023", new(2023, 8, 15), 40),
        new("Netwtw14", "x64", "Net", NetClass, "Intel", "23.60.1.2", new(2024, 5, 23), 40),
        new("mrvlpcie8897", "x64", "Net", NetClass, "Marvell", "15.68.17.215", new(2022, 1, 4), 120),
        new("iaStorVD", "x64", "SCSIAdapter", StorageClass, "Intel", "19.5.2.1049", new(2023, 10, 30), 40),
        new("iaStorAC", "x64", "SCSIAdapter", StorageClass, "Intel", "17.11.3.1010", new(2022, 6, 3), 210),
        new("iaLPSS2_I2C_TGL", "x64", "System", SystemClass, "Intel", "30.100.2104.1", new(2021, 1, 22), 120),
        new("TbtHostController", "x64", "System", SystemClass, "Intel", "1.41.1353.0", new(2023, 2, 2), 120),
        new("amdgpio2", "x64", "System", SystemClass, "AMD", "2.2.0.130", new(2023, 7, 11), 90),
        new("iigd_dch", "x64", "Display", DisplayClass, "Intel", "31.0.101.5592", new(2024, 6, 11), 40),
        new("nv_dispi", "x64", "Display", DisplayClass, "NVIDIA", "32.0.15.6094", new(2024, 8, 14), 40),
        new("RTKVHD64", "x64", "MEDIA", MediaClass, "Realtek", "6.0.9549.1", new(2023, 9, 21), 90),
        new("ibtusb", "x64", "Bluetooth", BluetoothClass, "Intel", "23.60.0.1", new(2024, 5, 16), 40),
        new("SynPD", "x64", "Mouse", "{4D36E96F-E325-11CE-BFC1-08002BE10318}", "Synaptics", "19.5.35.82", new(2022, 7, 15), 210),
        new("HidEventFilter", "x64", "HIDClass", HidClass, "Intel", "2.2.1.384", new(2022, 9, 13), 120),
        new("qcwlan64", "arm64", "Net", NetClass, "Qualcomm", "3.0.0.1312", new(2024, 4, 2), 21),
    ];

    private static readonly (string Name, string Applicability, string[] Infs)[] DriverGroups =
    [
        ("Network adapters", "All", ["e1d68x64", "rt640x64", "Netwtw14"]),
        ("Storage (Intel VMD)", "Matched", ["iaStorVD", "iaStorAC"]),
        ("Dell Latitude 5450", "Matched", ["e1d68x64", "Netwtw14", "iaStorVD", "iigd_dch", "RTKVHD64", "ibtusb", "HidEventFilter"]),
        ("HP EliteBook 840 G10", "Matched", ["Netwtw14", "iaStorVD", "iigd_dch", "TbtHostController", "SynPD"]),
        ("Lenovo ThinkPad T14 Gen 5", "Matched", ["rt640x64", "amdgpio2", "RTKVHD64"]),
        ("ARM64 devices", "Matched", ["qcwlan64"]),
    ];

    private static string DriverPackagesReport(DateTimeOffset now)
    {
        var text = new StringBuilder(Banner);
        foreach (var driver in Drivers) text.Append(PackageBlock(driver, now));
        text.Append($"\n===============================================================================\nTotal number of driver packages: {Drivers.Length}\n--------\n\nThe command completed successfully.\n");
        return text.ToString();
    }

    private static string DriverGroupsReport(DateTimeOffset now)
    {
        var text = new StringBuilder(Banner);
        foreach (var (name, applicability, infs) in DriverGroups)
        {
            text.Append($"""

                -----------------------------------------
                Driver Group: {name}
                -----------------------------------------
                Name: {name}
                ID: {Id($"group:{name}").ToString("B").ToUpperInvariant()}
                Applicability: {applicability}
                Enabled: Yes
                -----------------------------------------

                Driver Packages:
                -----------------------------------------

                """);
            foreach (var inf in infs) text.Append(PackageBlock(Drivers.First(d => d.Inf == inf), now));
            text.Append($"\n===============================================================================\nTotal number of driver packages: {infs.Length}\n--------\n\n");
        }
        text.Append($"\n===============================================================================\nTotal number of driver groups: {DriverGroups.Length}\n--------\n\nThe command completed successfully.\n");
        return text.ToString();
    }

    private const string Banner = "\nWindows Deployment Services Management Utility [Version 10.0.26100.1150]\n© Microsoft Corporation. All rights reserved.\n\n";

    private static string PackageBlock(Driver driver, DateTimeOffset now)
    {
        var id = Id($"driver:{driver.Inf}").ToString("B").ToUpperInvariant();
        var added = now.AddDays(-driver.AddedDaysAgo).Date.AddHours(10).AddMinutes(driver.Inf.Length * 3);
        return $"""

            -----------------------------------
            Driver Package Information
            -----------------------------------
            Id: {id}
            Name: {driver.Inf} [{driver.Architecture}]
            Date added: {added.ToString("dddd, MMMM d, yyyy h:mm:ss tt", English)}
            Enabled: Yes

            Package INF file path: \\{ServerName}\REMINST\Stores\Drivers\{driver.Inf}.inf_{driver.Architecture}_{id}\{driver.Inf}.inf
            Architecture: {driver.Architecture}
            Class name: {driver.Class}
            Class GUID: {driver.ClassGuid}
            Provider name: {driver.Provider}
            Locale name:
            Signed: Yes
            Version: {driver.Version}
            Date: {driver.Date.ToString("dddd, MMMM d, yyyy", English)} 12:00:00 AM
            -----------------------------------

            """;
    }

    // ---- Boot activity and events --------------------------------------------------------------------

    private sealed record DemoEvent(DateTimeOffset Time, int Id, Dictionary<string, string> Data, string Log = "Operational", string Provider = "Microsoft-Windows-Deployment-Services-Diagnostics");

    private static object Activity(DateTimeOffset now) => new
    {
        logStartsAt = Iso(now.AddDays(-9)),
        logMaxBytes = 67_108_864L,
        events = BootEvents(now).Select(e => new { time = Iso(e.Time), id = e.Id, data = e.Data }).ToArray(),
    };

    /// <summary>A week of boots: installs finished, failed and under way, and machines at each stage of booting.</summary>
    private static List<DemoEvent> BootEvents(DateTimeOffset now)
    {
        var events = new List<DemoEvent>();
        // Installing now: Windows 11 Pro, the image being applied.
        var a = Boot(events, now.AddMinutes(-26), "192.0.2.41", "00-00-5E-00-53-41", true);
        Install(events, a, now.AddMinutes(-24), "Windows 11", "Windows 11 Pro", @"CONTOSO\jdoe", applyMinutes: null);
        // Finished this morning: Windows 11 Enterprise, with driver injection.
        var b = Boot(events, now.AddHours(-3).AddMinutes(-12), "192.0.2.37", "00-00-5E-00-53-37", true);
        Install(events, b, now.AddHours(-3).AddMinutes(-10), "Windows 11", "Windows 11 Enterprise", @"CONTOSO\asmith", applyMinutes: 14);
        // Failed: the image couldn't be applied.
        var c = Boot(events, now.AddHours(-5).AddMinutes(-40), "192.0.2.52", "00-00-5E-00-53-52", false);
        Install(events, c, now.AddHours(-5).AddMinutes(-38), "Windows Server", "Windows Server 2025 Standard (Desktop Experience)", @"CONTOSO\jdoe", applyMinutes: null,
            fatalError: "Windows cannot install required files. The file may be corrupt or missing. Make sure all files required for installation are available, and restart the installation. Error code: 0x80070570");
        // At the boot menu right now, and one still downloading its boot image.
        Boot(events, now.AddMinutes(-2), "192.0.2.60", "00-00-5E-00-53-60", false, stopAt: BootStop.Menu);
        Boot(events, now.AddSeconds(-50), "192.0.2.63", "00-00-5E-00-53-63", true, stopAt: BootStop.Downloading);
        // Yesterday: one that never pressed F12, and one whose unattend request WDS refused.
        Boot(events, now.AddDays(-1).AddHours(-2), "192.0.2.70", "00-00-5E-00-53-70", false, stopAt: BootStop.PxeOnly);
        var g = Boot(events, now.AddDays(-1).AddHours(-4), "192.0.2.45", "00-00-5E-00-53-45", false);
        events.Add(new DemoEvent(g.Loaded.AddSeconds(20), BootActivity.UnattendBlocked, new() { ["ClientIP"] = g.Ip }, "Application", "WDSIMGSRV"));
        // Two days ago: a multicast install of Windows 11 Education.
        var h = Boot(events, now.AddDays(-2).AddHours(-1), "192.0.2.81", "00-00-5E-00-53-81", true);
        Install(events, h, now.AddDays(-2).AddHours(-1).AddMinutes(2), "Windows 11", "Windows 11 Education", @"CONTOSO\asmith", applyMinutes: 11,
            multicast: "WDS:Windows 11/install-win11-education.wim/1");
        return events.OrderBy(e => e.Time).ToList();
    }

    private enum BootStop { Loaded, Menu, Downloading, PxeOnly }

    private sealed record BootedClient(string Ip, string Mac, string DeviceId, DateTimeOffset Loaded);

    private static BootedClient Boot(List<DemoEvent> events, DateTimeOffset start, string ip, string mac, bool prestaged, BootStop stopAt = BootStop.Loaded)
    {
        var deviceId = Id($"device:{mac}").ToString("B").ToUpperInvariant();
        var pxe = new Dictionary<string, string>
        {
            ["ClientHardwareAddress"] = mac, ["ClientIP"] = ip, ["ClientDeviceID"] = deviceId, ["ClientArch"] = "4", ["ClientPrestaged"] = prestaged ? "true" : "false",
        };
        events.Add(new DemoEvent(start, BootActivity.PxeBoot, pxe));
        if (stopAt == BootStop.PxeOnly) return new BootedClient(ip, mac, deviceId, start);

        var t = start.AddSeconds(1);
        Download(events, ref t, ip, @"boot\x64\wdsmgfw.efi", 1_588_656, 1);
        events.Add(new DemoEvent(t.AddSeconds(7), BootActivity.PxeBoot, pxe));
        t = t.AddSeconds(8);
        Download(events, ref t, ip, @"\Boot\x64\bootmgfw.efi", 2_934_112, 1);
        Download(events, ref t, ip, $@"\Tmp\x64uefi{Id($"bcd:{mac}:{start:O}").ToString("B").ToUpperInvariant()}.bcd", 24_576, 0);
        if (stopAt == BootStop.Menu) return new BootedClient(ip, mac, deviceId, t);

        Download(events, ref t, ip, @"\Boot\Boot.SDI", 3_170_304, 1);
        if (stopAt == BootStop.Downloading)
        {
            events.Add(new DemoEvent(t, BootActivity.TftpStarted, new() { ["ClientIP"] = ip, ["FileName"] = @"\Boot\x64\Images\boot-win11-x64.wim", ["FileSize"] = "662345234" }));
            return new BootedClient(ip, mac, deviceId, t);
        }
        Download(events, ref t, ip, @"\Boot\x64\Images\boot-win11-x64.wim", 662_345_234, 14);
        return new BootedClient(ip, mac, deviceId, t);
    }

    private static void Download(List<DemoEvent> events, ref DateTimeOffset t, string ip, string file, long size, int seconds)
    {
        var data = new Dictionary<string, string> { ["ClientIP"] = ip, ["FileName"] = file, ["FileSize"] = size.ToString(CultureInfo.InvariantCulture) };
        events.Add(new DemoEvent(t, BootActivity.TftpStarted, data));
        t = t.AddSeconds(seconds);
        events.Add(new DemoEvent(t, BootActivity.TftpCompleted, data));
        t = t.AddSeconds(1);
    }

    /// <summary>The WDS client's events for an install; applyMinutes null means it's still applying.</summary>
    private static void Install(
        List<DemoEvent> events, BootedClient client, DateTimeOffset start, string group, string image, string user, int? applyMinutes,
        string? fatalError = null, string? multicast = null)
    {
        Dictionary<string, string> Fields(params (string, string)[] extra)
        {
            var data = new Dictionary<string, string>
            {
                ["SessionGUID"] = Id($"session:{client.Mac}:{start:O}").ToString("B").ToUpperInvariant(),
                ["ClientMAC"] = client.Mac, ["ClientIP"] = client.Ip, ["ClientDeviceID"] = client.DeviceId, ["ClientArch"] = "4",
            };
            foreach (var (name, value) in extra) data[name] = value;
            return data;
        }
        void Add(DateTimeOffset time, int id, params (string, string)[] extra) => events.Add(new DemoEvent(time, id, Fields(extra)));

        Add(start, DeploymentEvents.ClientStarted, ("ClientVersion", "10.0.26100.6584"), ("WinPEVersion", "10.0.26100.6584"));
        Add(start.AddSeconds(5), DeploymentEvents.UnattendMode, ("UnattendMode", "Attended"));
        var t = start.AddMinutes(1);
        Add(t, DeploymentEvents.ImageSelectedWithDetails, ("ImageGroup", group), ("ImageName", image), ("ImageLanguage", "en-US"), ("ImageArch", "x64"), ("FullUserName", user));
        Add(t.AddSeconds(3), DeploymentEvents.TransferStarted, ("ImageGroup", group), ("ImageName", image), ("MulticastNamespace", multicast ?? ""));
        if (multicast is not null)
            events.Add(new DemoEvent(t.AddSeconds(4), DeploymentEvents.MulticastJoined, new() { ["ClientMAC"] = client.Mac, ["ClientIP"] = client.Ip, ["NamespaceName"] = multicast, ["ObjectName"] = image }));
        Add(t.AddSeconds(6), DeploymentEvents.ApplyStarted, ("ImageGroup", group), ("ImageName", image));
        if (fatalError is not null)
        {
            events.Add(new DemoEvent(t.AddMinutes(3), DeploymentEvents.FatalError, Fields(("ErrorMessage", fatalError)), "Admin"));
            Add(t.AddMinutes(3).AddSeconds(2), DeploymentEvents.ClientEnded);
            return;
        }
        if (applyMinutes is not { } minutes) return;

        var applied = t.AddMinutes(minutes);
        Add(applied, DeploymentEvents.ApplyEnded, ("ImageGroup", group), ("ImageName", image));
        Add(applied.AddSeconds(1), DeploymentEvents.TransferEnded, ("ImageGroup", group), ("ImageName", image), ("MulticastNamespace", multicast ?? ""));
        if (multicast is not null)
            events.Add(new DemoEvent(applied.AddSeconds(2), DeploymentEvents.MulticastLeft, new() { ["ClientMAC"] = client.Mac, ["ClientIP"] = client.Ip, ["NamespaceName"] = multicast, ["ObjectName"] = image }));
        Add(applied.AddSeconds(5), DeploymentEvents.PostApplyStarted);
        Add(applied.AddSeconds(8), DeploymentEvents.DriverRequestCompleted, ("NumDriverPackages", "6"));
        Add(applied.AddSeconds(10), DeploymentEvents.DriverInjectionStarted);
        Add(applied.AddSeconds(41), DeploymentEvents.DriverInjectionEnded);
        Add(applied.AddSeconds(55), DeploymentEvents.PostApplyEnded);
        Add(applied.AddSeconds(57), DeploymentEvents.ClientEnded);
    }

    private static object Events(DateTimeOffset now, IReadOnlyDictionary<string, object?>? parameters)
    {
        var hours = parameters?.GetValueOrDefault("Hours") is int h ? h : 72;
        var since = now.AddHours(-hours);
        var recordId = 48_000;
        var events = BootEvents(now)
            .Where(e => e.Id is BootActivity.PxeBoot or BootActivity.TftpCompleted or BootActivity.UnattendBlocked || DeploymentEvents.IsDeploymentEvent(e.Id))
            .Select(e => Event(e.Time, e.Id, e.Log, e.Provider, e.Data, recordId++))
            .Append(Event(now.AddHours(-30), 4101, "Operational", "Microsoft-Windows-Deployment-Services-Diagnostics",
                new() { ["ClientIP"] = "192.0.2.88", ["FileName"] = @"\Boot\x64\Images\boot-win10-x64.wim", ["ErrorCode"] = "1460" }, recordId++))
            .Append(Event(now.AddDays(-9).AddHours(-3).AddMinutes(2), 256, "Application", "WDSServer", new(), recordId++))
            .Where(e => e.Time >= since)
            .OrderByDescending(e => e.Time)
            .ToArray();
        return new
        {
            events = events.Select(e => new
            {
                time = Iso(e.Time), id = e.Id, level = e.Level, levelName = e.LevelName, log = e.Log, provider = e.Provider,
                recordId = e.RecordId, message = e.Message, data = e.Data,
            }),
            routineHidden = 3_218,
            warnings = Array.Empty<string>(),
        };
    }

    private sealed record EventView(
        DateTimeOffset Time, int Id, int Level, string LevelName, string Log, string Provider, int RecordId, string Message, Dictionary<string, string> Data);

    private static EventView Event(DateTimeOffset time, int id, string log, string provider, Dictionary<string, string> data, int recordId)
    {
        var (level, message) = Describe(id, data);
        var logName = log is "Application" ? "Application" : $"Microsoft-Windows-Deployment-Services-Diagnostics/{log}";
        return new EventView(time, id, level, level switch { 2 => "Error", 3 => "Warning", _ => "Information" }, logName, provider, recordId, message, data);
    }

    // Messages as WDS words them, filled in from the event's fields.
    private static (int Level, string Message) Describe(int id, Dictionary<string, string> d)
    {
        string F(string name) => d.GetValueOrDefault(name) ?? "";
        string Client() => $"\n\n SessionGuid: {F("SessionGUID")}\n MAC: {F("ClientMAC")}\n IP: {F("ClientIP")}\n ClientDeviceID: {F("ClientDeviceID")}\n ClientArchitecture: {F("ClientArch")}";
        return id switch
        {
            BootActivity.PxeBoot => (4, $"The following client booted from PXE: \n\n Hardware Address: {F("ClientHardwareAddress")}\n IP: {F("ClientIP")}\n Device ID: {F("ClientDeviceID")}\n ClientArchitecture: {F("ClientArch")}\n Prestaged: {F("ClientPrestaged")}"),
            BootActivity.TftpCompleted => (4, $"The Following Client completed TFTP Download: \n\n Client IP: {F("ClientIP")}\n Filename: {F("FileName")}\n File Size: {F("FileSize")}"),
            4101 => (3, $"The Following Client failed TFTP Download: \n\n Client IP: {F("ClientIP")}\n Filename: {F("FileName")}\n ErrorCode: {F("ErrorCode")}"),
            BootActivity.UnattendBlocked => (3, "Unattend file request was made over an insecure connection. Windows Deployment Services has blocked the request to keep the system secure. For more information, see: https://go.microsoft.com/fwlink/?linkid=2344403"),
            256 => (4, "The Windows Deployment Services server started successfully."),
            DeploymentEvents.ClientStarted => (4, $"The following WDS Client has started: {Client()}\n ClientVer: {F("ClientVersion")}\n WinPEVer: {F("WinPEVersion")}"),
            DeploymentEvents.UnattendMode => (4, $"The following WDS Client has processed unattend mode: {Client()}\n UnattendMode: {F("UnattendMode")}"),
            DeploymentEvents.ImageSelectedWithDetails => (4, $"The following WDS Client has selected Image: {Client()}\n ImageGroup: {F("ImageGroup")}\n ImageName: {F("ImageName")}\n ImageLanguage: {F("ImageLanguage")}\n ImageArchitecture: {F("ImageArch")}\n FullUserName: {F("FullUserName")}"),
            DeploymentEvents.TransferStarted => (4, $"The following WDS Client has started Image Transfer: {Client()}\n ImageGroup: {F("ImageGroup")}\n ImageName: {F("ImageName")}\n MulticastNamespace: {F("MulticastNamespace")}"),
            DeploymentEvents.TransferEnded => (4, $"The following WDS Client has ended Image Transfer: {Client()}\n ImageGroup: {F("ImageGroup")}\n ImageName: {F("ImageName")}\n MulticastNamespace: {F("MulticastNamespace")}"),
            DeploymentEvents.ApplyStarted => (4, $"The following WDS Client has started Image Apply: {Client()}\n ImageGroup: {F("ImageGroup")}\n ImageName: {F("ImageName")}"),
            DeploymentEvents.ApplyEnded => (4, $"The following WDS Client has ended Image Apply: {Client()}\n ImageGroup: {F("ImageGroup")}\n ImageName: {F("ImageName")}"),
            DeploymentEvents.PostApplyStarted => (4, $"The following WDS Client has started Post Apply Actions: {Client()}"),
            DeploymentEvents.PostApplyEnded => (4, $"The following WDS Client has ended Post Apply Actions: {Client()}"),
            DeploymentEvents.ClientEnded => (4, $"The following WDS Client has ended: {Client()}"),
            DeploymentEvents.FatalError => (2, $"The following WDS Client has encountered Fatal Error: {Client()}\n ErrorMessage: {F("ErrorMessage")}"),
            DeploymentEvents.DriverInjectionStarted => (4, $"The following WDS Client has started offline driver injection: {Client()}"),
            DeploymentEvents.DriverInjectionEnded => (4, $"The following WDS Client has ended offline driver injection: {Client()}"),
            DeploymentEvents.DriverRequestCompleted => (4, $"Ddp request successfully completed for the following client: \n\n MAC: {F("ClientMAC")}\n IP: {F("ClientIP")}\n NumDriverPackages: {F("NumDriverPackages")}"),
            DeploymentEvents.MulticastJoined => (4, $"Client joined Multicast Session: \n\n ClientMAC: {F("ClientMAC")}\n ClientIP: {F("ClientIP")}\n NamespaceName: {F("NamespaceName")}\n ObjectName: {F("ObjectName")}"),
            DeploymentEvents.MulticastLeft => (4, $"Client exited Multicast Session: \n\n ClientMAC: {F("ClientMAC")}\n ClientIP: {F("ClientIP")}\n NamespaceName: {F("NamespaceName")}\n ObjectName: {F("ObjectName")}"),
            _ => (4, $"Event {id}"),
        };
    }

    // ---- Helpers -------------------------------------------------------------------------------------

    private static string Iso(DateTimeOffset time) => time.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture);

    /// <summary>The same GUID for the same seed, so the sample looks the same on every run.</summary>
    private static Guid Id(string seed) => new(MD5.HashData(Encoding.UTF8.GetBytes(seed)));

    private static string Slug(string name) =>
        new string(name.ToLowerInvariant().Select(c => char.IsAsciiLetterOrDigit(c) ? c : '-').ToArray()).Trim('-');
}

/// <summary>Text files the demo shows, embedded under WdsWeb.Demo: real WDSUTIL output, also used by the tests.</summary>
public static class DemoResources
{
    public static string Text(string name)
    {
        using var stream = typeof(DemoResources).Assembly.GetManifestResourceStream($"WdsWeb.Demo.{name}")
            ?? throw new InvalidOperationException($"There's no demo resource named {name}.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
