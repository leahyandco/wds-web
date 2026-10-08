using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Options;
using WdsWeb.Api.Auth;
using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Endpoints;

/// <summary>Signing in and out, and a health check the deployment script waits on.</summary>
public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        // ?deep=true also opens a session on the WDS server, so a deployment can check the service
        // really can manage WDS. That part answers only requests from this machine.
        app.MapGet("/api/health", async (bool? deep, HttpContext http, WdsScriptRunner wds, CancellationToken ct) =>
        {
            if (deep != true) return Results.Ok(new { status = "ok" });
            // Kestrel listens dual-stack, so 127.0.0.1 can arrive as ::ffff:127.0.0.1.
            if (http.Connection.RemoteIpAddress is not { } address || !IPAddress.IsLoopback(address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address))
                return Results.StatusCode(StatusCodes.Status403Forbidden);
            try
            {
                var target = await wds.RunAsync("Get-TargetInfo", ct: ct);
                return Results.Ok(new
                {
                    status = "ok",
                    version = ConsoleInfo.Version,
                    server = target.GetProperty("computerName"),
                    psVersion = target.GetProperty("psVersion"),
                    wdsService = target.GetProperty("wdsService"),
                    wdsModule = target.GetProperty("wdsModule"),
                });
            }
            catch (Exception ex) when (ex is WdsConnectionException or WdsScriptException or TimeoutException)
            {
                return Results.Json(new { status = "unhealthy", error = ex.Message }, statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        }).AllowAnonymous();

        var auth = app.MapGroup("/api/auth").AllowAnonymous();

        auth.MapGet("/me", (HttpContext http, IOptions<AuthOptions> options, WdsSessionPool pool) =>
            Session(http.User, options.Value, pool));

        auth.MapPost("/login", async (SignInRequest request, HttpContext http, WindowsSignIn windows, IOptions<AuthOptions> options,
            WdsSessionPool pool, ILoggerFactory loggers) =>
        {
            if (!options.Value.Enabled) return Results.Ok(Session(http.User, options.Value, pool));
            if (string.IsNullOrWhiteSpace(request.UserName) || string.IsNullOrEmpty(request.Password))
                throw new InvalidRequestException("Enter a user name and password.");

            var audit = loggers.CreateLogger("WdsWeb.Audit");
            var address = http.Connection.RemoteIpAddress?.ToString();
            var result = windows.Check(request.UserName, request.Password);
            if (!result.Succeeded)
            {
                audit.LogWarning("Sign-in refused for {User} from {Address}: {Reason}", request.UserName, address, result.Reason);
                // Deliberately vague: don't tell a stranger which half was wrong.
                return Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Sign-in failed",
                    detail: "The user name or password is wrong, or that account isn't allowed to use the WDS Console.");
            }

            var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, result.Account!)], CookieAuthenticationDefaults.AuthenticationScheme));
            await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);
            audit.LogInformation("{User} signed in from {Address}", result.Account, address);
            return Results.Ok(Session(principal, options.Value, pool));
        }).RequireRateLimiting("sign-in");

        auth.MapPost("/logout", async (HttpContext http, ILoggerFactory loggers) =>
        {
            var user = http.User.Identity?.Name;
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            if (user is not null) loggers.CreateLogger("WdsWeb.Audit").LogInformation("{User} signed out", user);
            return Results.NoContent();
        });
    }

    private static SessionResponse Session(ClaimsPrincipal user, AuthOptions options, WdsSessionPool pool) =>
        options.Enabled
            ? new SessionResponse(true, user.Identity?.IsAuthenticated == true, user.Identity?.Name, pool.TargetName)
            : new SessionResponse(false, true, null, pool.TargetName);
}

public sealed record SignInRequest(string? UserName, string? Password);

/// <param name="AuthEnabled">False in development, where there's no sign-in.</param>
/// <param name="Server">The WDS server this console manages, for the sign-in page.</param>
public sealed record SessionResponse(bool AuthEnabled, bool Authenticated, string? UserName, string Server);
