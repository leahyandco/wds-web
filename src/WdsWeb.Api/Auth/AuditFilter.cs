using System.Text.Json;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;

namespace WdsWeb.Api.Auth;

/// <summary>
/// Records who changed what: every request that isn't a read is logged under the "WdsWeb.Audit"
/// category (the Application event log when running as a service) with the signed-in user and the
/// request's parameters. Upload chunks are left out, as there can be thousands of them.
/// </summary>
public sealed class AuditFilter(ILoggerFactory loggers, IOptions<JsonOptions> json) : IEndpointFilter
{
    private readonly ILogger _audit = loggers.CreateLogger("WdsWeb.Audit");

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var request = context.HttpContext.Request;
        if (HttpMethods.IsGet(request.Method) || IsUploadChunk(context.HttpContext)) return await next(context);

        var user = context.HttpContext.User.Identity?.Name ?? "anonymous";
        var details = string.Join(" ", context.Arguments.Where(IsWorthLogging).Select(a => JsonSerializer.Serialize(a, a!.GetType(), json.Value.SerializerOptions)));
        try
        {
            var result = await next(context);
            _audit.LogInformation("{User} {Method} {Path} {Details}", user, request.Method, request.Path.Value, details);
            return result;
        }
        catch (Exception ex)
        {
            _audit.LogWarning("{User} {Method} {Path} failed: {Error} {Details}", user, request.Method, request.Path.Value, ex.Message, details);
            throw;
        }
    }

    private static bool IsUploadChunk(HttpContext http) =>
        HttpMethods.IsPut(http.Request.Method) && http.Request.Path.StartsWithSegments("/api/uploads");

    // Route values and request bodies; not services, the HttpRequest or the cancellation token.
    // Records are the request bodies here, and they carry a compiler-generated <Clone>$ method.
    private static bool IsWorthLogging(object? argument) =>
        argument is string or int or long or bool || argument?.GetType().GetMethod("<Clone>$") is not null;
}
