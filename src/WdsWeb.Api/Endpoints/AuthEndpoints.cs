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
        app.MapGet("/api/health", () => new { status = "ok" }).AllowAnonymous();

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
