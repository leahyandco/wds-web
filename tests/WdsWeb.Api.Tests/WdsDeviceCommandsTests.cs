using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

public class WdsDeviceCommandsTests
{
    [Fact]
    public void Adding_a_device_passes_only_what_was_given()
    {
        Assert.Equal(
            ["/Add-Device", "/Device:PC-01", "/ID:00-00-5E-00-53-01"],
            WdsDeviceCommands.Add(new NewDevice("PC-01", "00-00-5e-00-53-01", Group: " ", PxePromptPolicy: "")));

        Assert.Equal(
            [
                "/Add-Device", "/Device:PC-02", "/ID:00-00-5E-00-53-02", "/Group:Bench 2", "/PxePromptPolicy:NoPrompt",
                @"/BootImagePath:Boot\x64\Images\boot.wim", @"/WdsClientUnattend:WdsClientUnattend\x64.xml",
            ],
            WdsDeviceCommands.Add(new NewDevice("PC-02", "00005E005302", "Bench 2", "noprompt", @"Boot\x64\Images\boot.wim", @"WdsClientUnattend\x64.xml")));
    }

    [Theory]
    [InlineData("00-00-5E-00-53-01", "00-00-5E-00-53-01")]
    [InlineData("00005e005301", "00-00-5E-00-53-01")]
    [InlineData("00:00:5e:00:53:01", "00-00-5E-00-53-01")] // WDSUTIL refuses colons, so they're swapped for dashes
    [InlineData("0000.5e00.5301", "00-00-5E-00-53-01")]
    [InlineData("e8a3efac-201f-4e69-953e-b2daa1e8b1b6", "{E8A3EFAC-201F-4E69-953E-B2DAA1E8B1B6}")]
    [InlineData(" {E8A3EFAC-201F-4E69-953E-B2DAA1E8B1B6} ", "{E8A3EFAC-201F-4E69-953E-B2DAA1E8B1B6}")]
    public void Device_ids_take_the_form_wds_stores_them_in(string given, string expected)
    {
        Assert.Equal(expected, WdsDeviceCommands.DeviceId(given));
    }

    [Theory]
    [InlineData("")]
    [InlineData("00-00-5E-00-53")]
    [InlineData("00-00-5E-00-53-0G")]
    [InlineData("ACEFA3E81F20694E953EB2DAA1E8B1B6")] // bare GUID digits: byte order is ambiguous
    [InlineData("{E8A3EFAC-201F-4E69-953E-B2DAA1E8B1B6")]
    [InlineData("PC-01")]
    public void Device_ids_must_be_a_mac_address_or_a_dashed_guid(string given)
    {
        Assert.Throws<InvalidRequestException>(() => WdsDeviceCommands.DeviceId(given));
    }

    [Theory]
    [InlineData("PC 01")] // WDS refuses spaces: "DNS name contains an invalid character"
    [InlineData("-PC01")]
    [InlineData("PC01-")]
    [InlineData("PC/01")]
    [InlineData("PC01\"; /Remove-Device")]
    [InlineData("")]
    [InlineData("ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKL")] // 64 characters
    public void Device_names_must_be_host_names(string name)
    {
        Assert.Throws<InvalidRequestException>(() => WdsDeviceCommands.Add(new NewDevice(name, "00-00-5E-00-53-01")));
    }

    [Theory]
    [InlineData("PC-01")]
    [InlineData("pc_01")]
    [InlineData("WDSWEB-TEST05-LONGNM")] // longer than a NetBIOS name, which WDS accepts
    [InlineData("A")]
    public void Device_names_can_be_any_host_name(string name)
    {
        Assert.Equal($"/Device:{name}", WdsDeviceCommands.Remove(name)[1]);
    }

    [Fact]
    public void Changes_set_only_the_values_given_and_clear_empty_ones()
    {
        Assert.Equal(
            ["/Set-Device", "/Device:PC-01", "/PxePromptPolicy:OptOut", @"/BootImagePath:Boot\x64\Images\boot.wim"],
            WdsDeviceCommands.Change("PC-01", new DeviceChanges(PxePromptPolicy: "optout", BootImagePath: @"Boot\x64\Images\boot.wim")));

        // An empty prompt policy goes back to the server's; WDSUTIL has no "Default" for it.
        Assert.Equal(
            ["/Set-Device", "/Device:PC-01", "/ID:{E8A3EFAC-201F-4E69-953E-B2DAA1E8B1B6}", "/Group:", "/PxePromptPolicy:", "/BootImagePath:", "/WdsClientUnattend:"],
            WdsDeviceCommands.Change("PC-01", new DeviceChanges("e8a3efac-201f-4e69-953e-b2daa1e8b1b6", "", " ", "", "")));
    }

    [Fact]
    public void A_change_must_change_something()
    {
        Assert.Throws<InvalidRequestException>(() => WdsDeviceCommands.Change("PC-01", new DeviceChanges()));
    }

    [Fact]
    public void A_device_id_cannot_be_cleared()
    {
        Assert.Throws<InvalidRequestException>(() => WdsDeviceCommands.Change("PC-01", new DeviceChanges(DeviceId: "")));
    }

    [Theory]
    [InlineData(null, @"C:\Images\boot.wim", null)]
    [InlineData(null, @"Boot\x64\Images\..\..\..\Windows\boot.wim", null)]
    [InlineData(null, null, @"..\secrets.xml")]
    [InlineData(null, null, @"WdsClientUnattend\x64.txt")]
    [InlineData("Maybe", null, null)]
    [InlineData("Default", null, null)]
    [InlineData(null, null, null, "Bench \"2\"")]
    public void Changes_reject_values_wdsutil_should_not_get(string? prompt, string? bootImage, string? unattend, string? group = null)
    {
        Assert.Throws<InvalidRequestException>(() =>
            WdsDeviceCommands.Change("PC-01", new DeviceChanges(Group: group, PxePromptPolicy: prompt, BootImagePath: bootImage, WdsClientUnattend: unattend)));
    }

    [Fact]
    public void Approving_names_the_request_and_passes_what_was_given()
    {
        Assert.Equal(["/Approve-AutoAddDevices", "/RequestId:7"], WdsDeviceCommands.Approve(7, new DeviceApproval()));
        Assert.Equal(
            ["/Approve-AutoAddDevices", "/RequestId:12", "/MachineName:PC-12", @"/BootImagePath:Boot\x64\Images\boot.wim"],
            WdsDeviceCommands.Approve(12, new DeviceApproval("PC-12", @"Boot\x64\Images\boot.wim", "")));
    }

    [Fact]
    public void Rejecting_names_the_request()
    {
        Assert.Equal(["/Reject-AutoAddDevices", "/RequestId:7"], WdsDeviceCommands.Reject(7));
    }

    [Fact]
    public void Request_zero_is_not_a_request()
    {
        Assert.Throws<InvalidRequestException>(() => WdsDeviceCommands.Reject(0));
        Assert.Throws<InvalidRequestException>(() => WdsDeviceCommands.Approve(0, new DeviceApproval()));
    }
}
