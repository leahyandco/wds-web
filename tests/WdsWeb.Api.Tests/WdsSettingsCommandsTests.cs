using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

public class WdsSettingsCommandsTests
{
    [Fact]
    public void Pxe_settings_become_answer_delay_and_prompt_commands_in_wdsutil_spelling()
    {
        var commands = WdsSettingsCommands.For(new PxeSettings("known", 2, "noprompt", "OptIn"));

        Assert.Equal(
            [
                ["/Set-Server", "/AnswerClients:Known"],
                ["/Set-Server", "/ResponseDelay:2"],
                ["/Set-Server", "/PxePromptPolicy", "/Known:NoPrompt", "/New:OptIn"],
            ],
            commands);
    }

    [Theory]
    [InlineData("Everyone", 0, "OptIn")]
    [InlineData("All", -1, "OptIn")]
    [InlineData("All", 0, "Maybe")]
    public void Pxe_settings_reject_values_wdsutil_would_not_take(string answer, int delay, string prompt)
    {
        Assert.Throws<InvalidRequestException>(() => WdsSettingsCommands.For(new PxeSettings(answer, delay, prompt, "OptIn")));
    }

    [Fact]
    public void Boot_defaults_set_only_what_was_given_and_clear_with_an_empty_image()
    {
        var commands = WdsSettingsCommands.For(new BootDefaultsSettings(
            [
                new ArchitectureBootDefaults("x64uefi", @"Boot\x64\wdsmgfw.efi", @"Boot\x64\Images\boot.wim"),
                new ArchitectureBootDefaults("x64", null, ""),
            ],
            "both"));

        Assert.Equal(
            [
                ["/Set-Server", @"/BootProgram:Boot\x64\wdsmgfw.efi", "/Architecture:x64uefi"],
                ["/Set-Server", @"/BootImage:Boot\x64\Images\boot.wim", "/Architecture:x64uefi"],
                ["/Set-Server", "/BootImage:", "/Architecture:x64"],
                ["/Set-Server", "/DefaultX86X64ImageType:Both"],
            ],
            commands);
    }

    [Theory]
    [InlineData(@"..\Windows\System32\cmd.exe", null)]
    [InlineData(@"Boot\x64\wdsmgfw.exe", null)]
    [InlineData(null, @"C:\Images\boot.wim")]
    [InlineData(null, @"Boot\x64\boot.wim")]
    public void Boot_defaults_reject_paths_outside_the_boot_folders(string? program, string? image)
    {
        Assert.Throws<InvalidRequestException>(() => WdsSettingsCommands.For(
            new BootDefaultsSettings([new ArchitectureBootDefaults("x64", program, image)], null)));
    }

    [Fact]
    public void Client_settings_cover_logging_unattend_policy_and_files()
    {
        var commands = WdsSettingsCommands.For(new ClientSettings(true, "warnings", false, true,
            [new ClientUnattendFile("x64uefi", @"WdsClientUnattend\x64.xml"), new ClientUnattendFile("x86", "")]));

        Assert.Equal(
            [
                ["/Set-Server", "/WdsClientLogging", "/Enabled:Yes", "/LoggingLevel:Warnings"],
                ["/Set-Server", "/WdsUnattend", "/Policy:Disabled", "/CommandlinePrecedence:Yes"],
                ["/Set-Server", "/WdsUnattend", @"/File:WdsClientUnattend\x64.xml", "/Architecture:x64uefi"],
                ["/Set-Server", "/WdsUnattend", "/File:", "/Architecture:x86"],
            ],
            commands);
    }

    [Theory]
    [InlineData(@"..\secrets.xml")]
    [InlineData(@"C:\unattend.xml")]
    [InlineData("unattend.txt")]
    public void Client_settings_reject_unattend_files_outside_remoteinstall(string file)
    {
        Assert.Throws<InvalidRequestException>(() => WdsSettingsCommands.For(
            new ClientSettings(false, "Info", false, false, [new ClientUnattendFile("x64", file)])));
    }

    [Fact]
    public void Pending_device_settings_are_one_command_and_keep_the_message_as_one_argument()
    {
        var command = Assert.Single(WdsSettingsCommands.For(new PendingDeviceSettings("adminapproval", 10, 2160, "Waiting for approval", 30, 1)));

        Assert.Equal(
            ["/Set-Server", "/PendingDevicePolicy", "/Policy:AdminApproval", "/PollInterval:10", "/MaxRetry:2160",
             "/Message:Waiting for approval", "/RetentionPeriod", "/Approved:30", "/Others:1"],
            command);
    }

    [Theory]
    [InlineData("Say \"hi\"")]
    [InlineData("two\nlines")]
    public void Pending_device_messages_cannot_carry_quotes_or_line_breaks(string message)
    {
        Assert.Throws<InvalidRequestException>(() => WdsSettingsCommands.For(new PendingDeviceSettings("Disabled", 10, 10, message, 30, 1)));
    }

    [Fact]
    public void Bind_changes_set_the_policy_then_remove_then_add_with_normalised_addresses()
    {
        var commands = WdsSettingsCommands.For(new BindSettings("include",
            Add: [new BindAddress(" 192.0.2.10 ", "ip")],
            Remove: [new BindAddress("00:b0:56:88:2f:dc", "MAC")]));

        Assert.Equal(
            [
                ["/Set-Server", "/BindPolicy", "/Policy:Include"],
                ["/Set-Server", "/BindPolicy", "/Remove", "/Address:00-B0-56-88-2F-DC", "/AddressType:MAC"],
                ["/Set-Server", "/BindPolicy", "/Add", "/Address:192.0.2.10", "/AddressType:IP"],
            ],
            commands);
    }

    [Theory]
    [InlineData("192.0.2.300", "IP")]
    [InlineData("fe80::1", "IP")]
    [InlineData("00-B0-56-88-2F", "MAC")]
    public void Bind_changes_reject_bad_addresses(string address, string type)
    {
        Assert.Throws<InvalidRequestException>(() => WdsSettingsCommands.For(new BindSettings("Exclude", [new BindAddress(address, type)], null)));
    }

    [Fact]
    public void Transport_settings_cover_tftp_and_the_multicast_session_policy()
    {
        var commands = WdsSettingsCommands.For(new TransportSettings(0, false, "multistream", 256, 3, true));

        Assert.Equal(
            [
                ["/Set-TransportServer", "/TftpMaximumBlockSize:0", "/EnableTftpVariableWindowExtension:No"],
                ["/Set-TransportServer", "/MulticastSessionPolicy", "/Policy:Multistream", "/Threshold:256", "/StreamCount:3", "/Fallback:Yes"],
            ],
            commands);
    }

    [Theory]
    [InlineData(256)]
    [InlineData(65536)]
    public void Transport_settings_reject_tftp_block_sizes_out_of_range(int blockSize)
    {
        Assert.Throws<InvalidRequestException>(() => WdsSettingsCommands.For(new TransportSettings(blockSize, true, "None", 256, 2, true)));
    }

    [Fact]
    public void The_report_parser_reads_registered_bind_interfaces()
    {
        var nodes = WdsUtilOutputParser.Parse("""
            CONFIGURATION INFORMATION FOR SERVER
            Interface Bind Policy:
                 Policy: Exclude Registered
                 Registered interfaces:
                     MAC => 00B056882FDC
                     IP => 192.0.2.9
            """);

        var registered = nodes[0].Children[0].Children[1].Children;
        Assert.Equal([("MAC", "00B056882FDC"), ("IP", "192.0.2.9")], registered.Select(n => (n.Name, n.Value)));
    }
}
