using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

public class WdsDriverCommandsTests
{
    private const string Id = "{08611570-9951-4B50-A49A-F4EFAEBE3A0D}";

    [Fact]
    public void Adds_a_group_with_its_filters_in_one_command()
    {
        var command = WdsDriverCommands.AddGroup(new NewDriverGroup(
            "Latitude 5450 (Win11)",
            Filters:
            [
                new DriverGroupFilter("manufacturer", "include", ["Dell Inc."]),
                new DriverGroupFilter("Chassis Type", "Exclude", ["Mini Tower", "tower"]),
            ]));

        Assert.Equal(
            [
                "/Add-DriverGroup", "/DriverGroup:Latitude 5450 (Win11)", "/Enabled:Yes", "/Applicability:Matched",
                "/FilterType:Manufacturer", "/Policy:Include", "/Value:Dell Inc.",
                "/FilterType:ChassisType", "/Policy:Exclude", "/Value:MiniTower", "/Value:Tower",
            ],
            command);
    }

    [Fact]
    public void Replaces_filters_by_removing_the_types_the_group_has()
    {
        // WDSUTIL refuses to remove a filter type a group doesn't have, so only the current ones are named.
        DriverGroupFilter[] current = [new("Manufacturer", "Include", ["Dell Inc."]), new("Model", "Include", ["Latitude 5440"])];

        var commands = WdsDriverCommands.ChangeGroup("Dell", new DriverGroupChanges(
            Name: "Dell laptops",
            Filters: [new DriverGroupFilter("Manufacturer", "Include", ["Dell Inc."]), new DriverGroupFilter("Model", "Include", ["Latitude 5440", "Latitude 5450"])]),
            current);

        Assert.Equal(
            [
                ["/Remove-DriverGroupFilter", "/DriverGroup:Dell", "/FilterType:Manufacturer", "/FilterType:Model"],
                ["/Add-DriverGroupFilter", "/DriverGroup:Dell", "/FilterType:Manufacturer", "/Policy:Include", "/Value:Dell Inc.",
                    "/FilterType:Model", "/Policy:Include", "/Value:Latitude 5440", "/Value:Latitude 5450"],
                // Renamed last, so the filter commands find it by its old name.
                ["/Set-DriverGroup", "/DriverGroup:Dell", "/Name:Dell laptops"],
            ],
            commands);
    }

    [Fact]
    public void Leaves_filters_alone_when_they_are_the_same()
    {
        DriverGroupFilter[] current = [new("Model", "Include", ["Latitude 5450", "Latitude 5440"])];

        var commands = WdsDriverCommands.ChangeGroup("Dell", new DriverGroupChanges(
            Enabled: false, Filters: [new DriverGroupFilter("Model", "Include", ["latitude 5440", "Latitude 5450"])]), current);

        Assert.Equal([["/Set-DriverGroup", "/DriverGroup:Dell", "/Enabled:No"]], commands);
    }

    [Fact]
    public void Clearing_filters_only_removes_them()
    {
        var commands = WdsDriverCommands.ChangeGroup("Dell", new DriverGroupChanges(Filters: []), [new("Model", "Include", ["Latitude 5450"])]);

        Assert.Equal([["/Remove-DriverGroupFilter", "/DriverGroup:Dell", "/FilterType:Model"]], commands);
    }

    [Fact]
    public void A_change_that_changes_nothing_is_refused()
    {
        Assert.Throws<InvalidRequestException>(() => WdsDriverCommands.ChangeGroup("Dell", new DriverGroupChanges(Name: " Dell "), []));
    }

    [Theory]
    [InlineData("")]
    [InlineData("Dell\tHP")]
    [InlineData("-Dell")]
    [InlineData("Dell \"Inc\"")]
    [InlineData("Dell/HP")]
    [InlineData(@"Dell\")]
    [InlineData("ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLM")] // 65 characters
    public void Group_names_are_checked(string name)
    {
        Assert.Throws<InvalidRequestException>(() => WdsDriverCommands.AddGroup(new NewDriverGroup(name)));
    }

    [Theory]
    [InlineData("Model", "Include", "Latitude \"5450\"")] // quotes would break WDSUTIL's command line
    [InlineData("Model", "Include", @"C:\Drivers\")]       // so would a trailing backslash
    [InlineData("ChassisType", "Include", "Spaceship")]
    [InlineData("Colour", "Include", "Blue")]
    [InlineData("Model", "Maybe", "Latitude")]
    public void Filters_are_checked(string type, string policy, string value)
    {
        Assert.Throws<InvalidRequestException>(() => WdsDriverCommands.AddGroup(new NewDriverGroup("Dell", Filters: [new DriverGroupFilter(type, policy, [value])])));
    }

    [Fact]
    public void Each_filter_type_is_given_once()
    {
        Assert.Throws<InvalidRequestException>(() => WdsDriverCommands.AddGroup(new NewDriverGroup(
            "Dell", Filters: [new DriverGroupFilter("Model", "Include", ["A"]), new DriverGroupFilter("model", "Exclude", ["B"])])));
    }

    [Fact]
    public void Changes_and_removes_packages_by_id()
    {
        Assert.Equal(
            ["/Set-DriverPackage", $"/PackageId:{Id}", "/Name:USB host controller", "/Enabled:No"],
            WdsDriverCommands.ChangePackage("08611570-9951-4b50-a49a-f4efaebe3a0d", new DriverPackageChanges("USB host controller", false)));
        Assert.Equal(["/Remove-DriverPackage", $"/PackageId:{Id}"], WdsDriverCommands.RemovePackage(Id));
        Assert.Throws<InvalidRequestException>(() => WdsDriverCommands.RemovePackage("vmusb [x64]"));
    }

    [Fact]
    public void Batches_run_one_command_per_package()
    {
        const string other = "{3D89217B-5327-45F4-97A1-007882C562E9}";

        Assert.Equal(
            [["/Add-DriverGroupPackage", "/DriverGroup:Dell laptops", $"/PackageId:{Id}"], ["/Add-DriverGroupPackage", "/DriverGroup:Dell laptops", $"/PackageId:{other}"]],
            WdsDriverCommands.Batch(new DriverPackageBatch([Id, other, Id.ToLowerInvariant()], DriverPackageAction.AddToGroup, "Dell laptops")));
        Assert.Equal([["/Set-DriverPackage", $"/PackageId:{Id}", "/Enabled:Yes"]], WdsDriverCommands.Batch(new DriverPackageBatch([Id], DriverPackageAction.Enable)));
        Assert.Throws<InvalidRequestException>(() => WdsDriverCommands.Batch(new DriverPackageBatch([Id], DriverPackageAction.RemoveFromGroup)));
        Assert.Throws<InvalidRequestException>(() => WdsDriverCommands.Batch(new DriverPackageBatch([], DriverPackageAction.Remove)));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("X64", "x64")]
    [InlineData("arm64", "arm64")]
    public void Architectures_are_wdsutils_names(string? given, string? expected)
    {
        Assert.Equal(expected, WdsDriverCommands.Architecture(given));
    }

    [Fact]
    public void Unknown_architectures_are_refused()
    {
        Assert.Throws<InvalidRequestException>(() => WdsDriverCommands.Architecture("amd64"));
    }
}
