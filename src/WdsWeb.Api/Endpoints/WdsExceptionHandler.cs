using Microsoft.AspNetCore.Diagnostics;
using WdsWeb.Api.Wds;

namespace WdsWeb.Api.Endpoints;

/// <summary>Turns WDS failures into problem-details responses whose detail the UI can show as-is.</summary>
internal sealed class WdsExceptionHandler(IProblemDetailsService problemDetails, ILogger<WdsExceptionHandler> logger)
    : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        (int Status, string Title)? mapped = exception switch
        {
            WdsScriptException => (StatusCodes.Status502BadGateway, "WDS command failed"),
            WdsConnectionException => (StatusCodes.Status503ServiceUnavailable, "Can't reach the WDS server"),
            TimeoutException => (StatusCodes.Status504GatewayTimeout, "WDS command timed out"),
            _ => null,
        };
        if (mapped is not { } problem) return false;

        logger.LogWarning("{Title}: {Message}", problem.Title, exception.Message);
        context.Response.StatusCode = problem.Status;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            Exception = exception,
            ProblemDetails = { Status = problem.Status, Title = problem.Title, Detail = exception.Message },
        });
    }
}
