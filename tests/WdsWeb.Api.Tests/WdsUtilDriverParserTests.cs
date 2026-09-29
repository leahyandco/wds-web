using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Tests;

/// <summary>Trimmed WDSUTIL driver reports from a real WDS server.</summary>
public class WdsUtilDriverParserTests
{
    private static readonly string Packages = Fixture("get-alldriverpackages.txt");
    private static readonly string Groups = Fixture("get-alldrivergroups.txt");

    [Fact]
    public void Reads_every_package_block()
    {
        var catalog = WdsUtilDriverParser.Parse(Packages, Groups);

        Assert.Equal(3, catalog.Packages.Count);
        var synpd = catalog.Packages[0];
        Assert.Equal("{3D89217B-5327-45F4-97A1-007882C562E9}", synpd.Id);
        Assert.Equal("synpd [x64]", synpd.Name);
        Assert.Equal(("x64", "Mouse", "Synaptics", "15.2.7.0"), (synpd.Architecture, synpd.ClassName, synpd.Provider, synpd.Version));
        Assert.True(synpd.Enabled);
        Assert.True(synpd.Signed);
        Assert.Null(synpd.Locale);
        Assert.EndsWith(@"\synpd.inf", synpd.InfPath);
    }

    [Fact]
    public void Turns_wdsutil_dates_into_iso_dates()
    {
        var synpd = WdsUtilDriverParser.Parse(Packages, Groups).Packages[0];

        // "Tuesday, February 8, 2011 12:00:00 AM" and "Sunday, May 10, 2026 12:11:40 AM"
        Assert.Equal("2011-02-08", synpd.Date);
        Assert.Equal("2026-05-10T00:11:40", synpd.DateAdded);
    }

    [Fact]
    public void Reads_groups_with_their_package_counts()
    {
        var groups = WdsUtilDriverParser.Parse(Packages, Groups).Groups;

        Assert.Equal(["DriverGroup1", "RealtekLAN-Win11"], groups.Select(g => g.Name));
        Assert.Equal([0, 1], groups.Select(g => g.PackageCount));
        Assert.Equal("{9F5B530D-06B9-47BC-BE0D-B90E8F904141}", groups[1].Id);
        Assert.All(groups, g => Assert.True(g.Enabled));
        Assert.All(groups, g => Assert.Equal("Matched", g.Applicability));
    }

    [Fact]
    public void Tags_packages_with_the_groups_they_belong_to()
    {
        // The group report lists its packages in full, so it can stand in for the package list too.
        var catalog = WdsUtilDriverParser.Parse(Groups, Groups);

        var realtek = Assert.Single(catalog.Packages);
        Assert.Equal("ws640x64 [x64]", realtek.Name);
        Assert.Equal(["RealtekLAN-Win11"], realtek.Groups);
    }

    [Fact]
    public void Packages_in_no_group_have_no_groups()
    {
        Assert.All(WdsUtilDriverParser.Parse(Packages, Groups).Packages, p => Assert.Empty(p.Groups));
    }

    private static string Fixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
