using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Logging.EventLog;
using WdsWeb.Api.Auth;
using WdsWeb.Api.Endpoints;
using WdsWeb.Api.Wds;

// A Windows service starts in System32, so look for appsettings and wwwroot next to the program instead.
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = WindowsServiceHelpers.IsWindowsService() ? AppContext.BaseDirectory : null,
});

// This machine's own settings (HTTPS port and certificate, allowed groups) live outside the install
// folder, so deploying a new build never overwrites them.
var machineData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "WdsWeb");
builder.Configuration.AddJsonFile(Path.Combine(machineData, "settings.json"), optional: true, reloadOnChange: false);

builder.Services.AddWindowsService(options => options.ServiceName = "WdsWeb");
builder.Logging.AddEventLog(settings => settings.SourceName = "WDS Console");
builder.Logging.AddFilter<EventLogLoggerProvider>("WdsWeb.Audit", LogLevel.Information);

UseHttpsIfConfigured(builder);

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));
builder.Services.Configure<WdsOptions>(builder.Configuration.GetSection(WdsOptions.SectionName));
builder.Services.AddSingleton<WdsSessionPool>();
builder.Services.AddSingleton<WdsScriptRunner>();
builder.Services.AddSingleton<StagingArea>();
builder.Services.AddSingleton<UploadStore>();
builder.Services.AddSingleton<ImportQueue>();
builder.Services.AddHostedService(services => services.GetRequiredService<ImportQueue>());
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<WdsExceptionHandler>();

var auth = builder.Configuration.GetSection(AuthOptions.SectionName).Get<AuthOptions>() ?? new AuthOptions();
builder.Services.Configure<AuthOptions>(builder.Configuration.GetSection(AuthOptions.SectionName));
builder.Services.AddSingleton<WindowsSignIn>();
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(cookie =>
{
    cookie.Cookie.Name = "wdsweb";
    cookie.Cookie.HttpOnly = true;
    cookie.Cookie.SameSite = SameSiteMode.Strict;
    cookie.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    cookie.ExpireTimeSpan = auth.SessionLifetime;
    cookie.SlidingExpiration = true;
    // This is an API: answer 401 and 403 rather than redirecting to a login page.
    cookie.Events.OnRedirectToLogin = context =>
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    };
    cookie.Events.OnRedirectToAccessDenied = context =>
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    };
});
builder.Services.AddAuthorization(options =>
{
    // Every endpoint needs a signed-in user unless it says otherwise (sign-in, health, the SPA).
    if (auth.Enabled) options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
});
if (WindowsServiceHelpers.IsWindowsService())
{
    // Keep the cookie keys across restarts, readable only on this machine.
    builder.Services.AddDataProtection()
        .SetApplicationName("WdsWeb")
        .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(machineData, "keys")))
        .ProtectKeysWithDpapi(protectToLocalMachine: true);
}
builder.Services.AddRateLimiter(limiter =>
{
    limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // Ten sign-in attempts per address every five minutes.
    limiter.AddPolicy("sign-in", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(5) }));
});

var app = builder.Build();

if (!auth.Enabled && !app.Environment.IsDevelopment())
    app.Logger.LogWarning("Sign-in is turned off (Auth:Enabled is false): anyone who can reach this service can change WDS.");

app.UseExceptionHandler();

// The built frontend (web/, output to wwwroot) is served from here in production. In development
// the Vite dev server serves it instead and proxies /api to this service.
var staticFiles = new StaticFileOptions { OnPrepareResponse = SetCacheHeaders };
app.UseDefaultFiles();
app.UseStaticFiles(staticFiles);

app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapAuthEndpoints();
var audited = app.MapGroup("").AddEndpointFilter<AuditFilter>();
audited.MapWdsEndpoints();
audited.MapImageEndpoints();
audited.MapSettingsEndpoints();
app.MapFallbackToFile("index.html", staticFiles).AllowAnonymous();

app.Run();

// Vite fingerprints everything under /assets, so those files can be cached for good. Everything else,
// index.html above all, must be revalidated so that a new build shows up on the next page load.
static void SetCacheHeaders(StaticFileResponseContext context) =>
    context.Context.Response.Headers.CacheControl = context.Context.Request.Path.StartsWithSegments("/assets")
        ? "public, max-age=31536000, immutable"
        : "no-cache";

// With Https:Port and Https:CertificateThumbprint set (by the deployment script, in settings.json),
// listen on that port only, using that certificate from the machine's personal store. Without them,
// the launch profile or ASPNETCORE_URLS decides, as in development.
static void UseHttpsIfConfigured(WebApplicationBuilder builder)
{
    var https = builder.Configuration.GetSection("Https");
    if (https.GetValue<int?>("Port") is not { } port) return;

    var thumbprint = https["CertificateThumbprint"]
        ?? throw new InvalidOperationException("Https:CertificateThumbprint is required along with Https:Port.");
    using var store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
    store.Open(OpenFlags.ReadOnly);
    var certificate = store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint, validOnly: false).OfType<X509Certificate2>().FirstOrDefault()
        ?? throw new InvalidOperationException($"There's no certificate with thumbprint {thumbprint} in LocalMachine\\My.");
    builder.WebHost.ConfigureKestrel(kestrel => kestrel.ListenAnyIP(port, listen => listen.UseHttps(certificate)));
}

// For the tests' WebApplicationFactory.
public partial class Program;
