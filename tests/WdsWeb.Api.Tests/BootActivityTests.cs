using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

public class BootActivityTests
{
    private const string Ip = "192.0.2.52";
    private const string Mac = "00-00-5E-00-53-01";
    private const string Image = @"\Boot\x64\Images\boot-windows11-25h2.wim";
    private static readonly DateTimeOffset T0 = new(2026, 9, 29, 8, 43, 52, TimeSpan.Zero);

    [Fact]
    public void Groups_a_real_UEFI_boot_into_one_session()
    {
        // The sequence a WDS server logged when a UEFI client booted Windows 11 25H2 over PXE.
        var events = new[]
        {
            Transfer(0, BootActivity.TftpStarted, @"boot\x64\wdsmgfw.efi"),
            Transfer(1, BootActivity.TftpCompleted, @"boot\x64\wdsmgfw.efi"),
            Pxe(0),
            Pxe(9),
            Transfer(10, BootActivity.TftpStarted, @"\Boot\x64\bootmgfw.efi"),
            Transfer(10, BootActivity.TftpCompleted, @"\Boot\x64\bootmgfw.efi"),
            Transfer(11, BootActivity.TftpStarted, @"\Tmp\x64uefi{E020E777-3A10-4BD3-9511-AAD66BBEC6E3}.bcd"),
            Transfer(11, BootActivity.TftpCompleted, @"\Tmp\x64uefi{E020E777-3A10-4BD3-9511-AAD66BBEC6E3}.bcd"),
            Transfer(12, BootActivity.TftpStarted, @"\Boot\Boot.SDI"),
            Transfer(12, BootActivity.TftpCompleted, @"\Boot\Boot.SDI"),
            Transfer(14, BootActivity.TftpStarted, Image, "662345234"),
            Transfer(25, BootActivity.TftpCompleted, Image, "662345234"),
        };

        var session = Assert.Single(BootActivity.Build(events, T0.AddMinutes(5)));

        Assert.Equal(BootStatus.Loaded, session.Status);
        Assert.Equal((Ip, Mac, "x64uefi", 4, false), (session.ClientIp, session.MacAddress, session.Architecture, session.ArchitectureCode, session.Prestaged));
        Assert.Equal(Image, session.BootImage);
        Assert.Equal(5, session.Transfers.Count);
        Assert.All(session.Transfers, t => Assert.True(t.Succeeded));
        Assert.Equal(662345234, session.Transfers[^1].FileSize);
        Assert.Equal(TimeSpan.FromSeconds(11), session.Transfers[^1].FinishedAt - session.Transfers[^1].StartedAt);
    }

    [Fact]
    public void Starts_a_new_session_when_the_client_boots_again_after_loading_an_image()
    {
        var events = new[]
        {
            Pxe(0),
            Transfer(5, BootActivity.TftpStarted, Image),
            Transfer(15, BootActivity.TftpCompleted, Image),
            Pxe(120),
        };

        var sessions = BootActivity.Build(events, T0.AddMinutes(10));

        Assert.Equal([BootStatus.PxeOnly, BootStatus.Loaded], sessions.Select(s => s.Status));
    }

    [Fact]
    public void Keeps_clients_apart_by_ip()
    {
        var events = new[] { Pxe(0), Pxe(1, ip: "192.0.2.60", mac: "AA-BB-CC-DD-EE-FF") };

        var sessions = BootActivity.Build(events, T0.AddMinutes(1));

        Assert.Equal(["192.0.2.60", Ip], sessions.Select(s => s.ClientIp));
    }

    [Fact]
    public void Reports_a_failed_download_and_its_error()
    {
        var events = new[]
        {
            Pxe(0),
            Transfer(5, BootActivity.TftpStarted, Image),
            Transfer(9, BootActivity.TftpFailed, Image, errorCode: "0x80070020"),
        };

        var session = Assert.Single(BootActivity.Build(events, T0.AddMinutes(1)));

        Assert.Equal(BootStatus.Failed, session.Status);
        Assert.Equal("0x80070020", session.Transfers.Single().ErrorCode);
    }

    [Theory]
    [InlineData(2, BootStatus.Downloading)]
    [InlineData(60, BootStatus.Incomplete)]
    public void An_unfinished_image_download_is_in_progress_until_it_goes_quiet(int minutesLater, BootStatus expected)
    {
        var events = new[] { Pxe(0), Transfer(5, BootActivity.TftpStarted, Image) };

        var session = Assert.Single(BootActivity.Build(events, T0.AddMinutes(minutesLater)));

        Assert.Equal(expected, session.Status);
    }

    [Fact]
    public void Shows_the_boot_menu_state_before_an_image_is_chosen()
    {
        var events = new[]
        {
            Pxe(0),
            Transfer(1, BootActivity.TftpStarted, @"\Boot\x64\bootmgfw.efi"),
            Transfer(1, BootActivity.TftpCompleted, @"\Boot\x64\bootmgfw.efi"),
        };

        Assert.Equal(BootStatus.BootMenu, Assert.Single(BootActivity.Build(events, T0.AddMinutes(1))).Status);
    }

    [Fact]
    public void Records_a_finish_whose_start_scrolled_out_of_the_log()
    {
        var session = Assert.Single(BootActivity.Build([Transfer(0, BootActivity.TftpCompleted, Image)], T0.AddMinutes(1)));

        Assert.Equal(BootStatus.Loaded, session.Status);
        Assert.Null(session.Transfers.Single().StartedAt);
        Assert.Null(session.MacAddress);
    }

    [Fact]
    public void Adds_a_refused_unattend_request_to_the_boot_that_loaded_the_image()
    {
        // As a WDS server logged it: the image loads, then Setup's unattend request is refused.
        var events = new[]
        {
            Pxe(0),
            Transfer(5, BootActivity.TftpStarted, Image),
            Transfer(20, BootActivity.TftpCompleted, Image),
            UnattendRefused(42),
        };

        var session = Assert.Single(BootActivity.Build(events, T0.AddMinutes(5)));

        Assert.Equal(BootStatus.Loaded, session.Status);
        Assert.Equal(new BootNote(T0.AddSeconds(42), BootNoteKind.UnattendBlocked), Assert.Single(session.Notes));
        Assert.Equal(T0.AddSeconds(42), session.LastSeen);
    }

    [Fact]
    public void Keeps_a_refused_unattend_request_whose_boot_scrolled_out_of_the_log()
    {
        var session = Assert.Single(BootActivity.Build([UnattendRefused(0)], T0.AddMinutes(1)));

        Assert.Single(session.Notes);
        // Setup only asks once WinPE is running, so the boot image must have loaded.
        Assert.Equal(BootStatus.Loaded, session.Status);
    }

    [Fact]
    public void Follows_an_install_through_the_wds_client_events()
    {
        // WinPE got a different address from the PXE boot, so the session is found by MAC address.
        const string winPeIp = "192.0.2.77";
        var events = new[]
        {
            Pxe(0),
            Transfer(5, BootActivity.TftpStarted, Image),
            Transfer(20, BootActivity.TftpCompleted, Image),
            Client(60, DeploymentEvents.ClientStarted, winPeIp, ("ClientVersion", "10.0.26100.1"), ("WinPEVersion", "10.0.26100.1")),
            Client(120, DeploymentEvents.ImageSelectedWithDetails, winPeIp, ("ImageGroup", "Windows 11"), ("ImageName", "Windows 11 Pro"),
                ("ImageLanguage", "en-US"), ("ImageArch", "x64"), ("FullUserName", @"CONTOSO\jdoe")),
            Client(125, DeploymentEvents.TransferStarted, winPeIp),
            Client(130, DeploymentEvents.ApplyStarted, winPeIp),
            // A long quiet apply: more than the usual half-hour gap.
            Client(130 + 50 * 60, DeploymentEvents.ApplyEnded, winPeIp),
            Client(131 + 50 * 60, DeploymentEvents.TransferEnded, winPeIp),
            Client(140 + 50 * 60, DeploymentEvents.ClientEnded, winPeIp),
        };

        var session = Assert.Single(BootActivity.Build(events, T0.AddHours(2)));

        var deployment = Assert.IsType<Deployment>(session.Deployment);
        Assert.Equal(DeploymentStage.Finished, deployment.Stage);
        Assert.Equal(("Windows 11", "Windows 11 Pro", @"CONTOSO\jdoe"), (deployment.ImageGroup, deployment.ImageName, deployment.UserName));
        Assert.Equal(T0.AddSeconds(130), deployment.ApplyStartedAt);
        Assert.Equal(T0.AddSeconds(140 + 50 * 60), deployment.FinishedAt);
        Assert.Equal(7, deployment.Timeline.Count);
        Assert.Equal(Ip, session.ClientIp);
    }

    [Fact]
    public void A_fatal_error_fails_the_install_and_says_why()
    {
        var events = new[]
        {
            Client(0, DeploymentEvents.ClientStarted, Ip),
            Client(30, DeploymentEvents.FatalError, Ip, ("ErrorMessage", "Windows cannot find the disk to install to.")),
            Client(31, DeploymentEvents.ClientEnded, Ip),
        };

        var deployment = Assert.IsType<Deployment>(Assert.Single(BootActivity.Build(events, T0.AddMinutes(5))).Deployment);

        Assert.Equal(DeploymentStage.Failed, deployment.Stage);
        Assert.Equal("Windows cannot find the disk to install to.", deployment.Error);
    }

    [Fact]
    public void Shows_driver_errors_in_hex()
    {
        var events = new[]
        {
            Client(0, DeploymentEvents.ClientStarted, Ip),
            Client(5, DeploymentEvents.DriverInjectionFailed, Ip, ("DriverPackageName", "e1d68x64.inf"), ("ErrorCode", "-2147024891")),
        };

        var deployment = Assert.IsType<Deployment>(Assert.Single(BootActivity.Build(events, T0.AddMinutes(5))).Deployment);

        Assert.Contains(deployment.Timeline, note => note.Level == "warning" && note.Text.Contains("e1d68x64.inf (error 0x80070005)"));
    }

    [Fact]
    public void Notes_a_client_wds_ignored_for_not_being_prestaged()
    {
        var ignored = new WdsEventRecord(T0, BootActivity.NotRecognized, new Dictionary<string, string>
        {
            ["ClientHardwareAddress"] = Mac,
            ["ClientIP"] = Ip,
            ["ClientPrestaged"] = "false",
        });

        var session = Assert.Single(BootActivity.Build([ignored, ignored with { Time = T0.AddSeconds(4) }], T0.AddMinutes(1)));

        Assert.Equal(BootNoteKind.NotRecognized, Assert.Single(session.Notes).Kind);
        Assert.Equal(BootStatus.PxeOnly, session.Status);
    }

    // A WDS client event as client logging records it: the MAC address with every event.
    private static WdsEventRecord Client(int seconds, int id, string ip, params (string Name, string Value)[] fields)
    {
        var data = new Dictionary<string, string> { ["SessionGUID"] = "{0A1B2C3D-0000-0000-0000-000000000001}", ["ClientMAC"] = Mac, ["ClientIP"] = ip };
        foreach (var (name, value) in fields) data[name] = value;
        return new WdsEventRecord(T0.AddSeconds(seconds), id, data);
    }

    private static WdsEventRecord UnattendRefused(int seconds) =>
        new(T0.AddSeconds(seconds), BootActivity.UnattendBlocked, new Dictionary<string, string> { ["ClientIP"] = Ip });

    private static WdsEventRecord Pxe(int seconds, string ip = Ip, string mac = Mac) =>
        new(T0.AddSeconds(seconds), BootActivity.PxeBoot, new Dictionary<string, string>
        {
            ["ClientHardwareAddress"] = mac,
            ["ClientIP"] = ip,
            ["ClientDeviceID"] = "{E8A3EFAC-201F-4E69-953E-B2DAA1E8B1B6}",
            ["ClientArch"] = "4",
            ["ClientPrestaged"] = "false",
        });

    private static WdsEventRecord Transfer(int seconds, int id, string file, string size = "1024", string? errorCode = null)
    {
        var data = new Dictionary<string, string> { ["ClientIP"] = Ip, ["FileName"] = file, ["FileSize"] = size };
        if (errorCode is not null) data["ErrorCode"] = errorCode;
        return new WdsEventRecord(T0.AddSeconds(seconds), id, data);
    }
}
