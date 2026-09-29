using System.Text.Json.Serialization;
using Microsoft.AspNetCore.StaticFiles;
using WdsWeb.Api.Endpoints;
using WdsWeb.Api.Wds;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase)));
builder.Services.Configure<WdsOptions>(builder.Configuration.GetSection(WdsOptions.SectionName));
builder.Services.AddSingleton<WdsSessionPool>();
builder.Services.AddSingleton<WdsScriptRunner>();
builder.Services.AddSingleton<StagingArea>();
builder.Services.AddSingleton<UploadStore>();
builder.Services.AddSingleton<ImportQueue>();
builder.Services.AddHostedService(services => services.GetRequiredService<ImportQueue>());
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<WdsExceptionHandler>();

var app = builder.Build();

app.UseExceptionHandler();

// The built frontend (web/, output to wwwroot) is served from here in production. In development
// the Vite dev server serves it instead and proxies /api to this service.
var staticFiles = new StaticFileOptions { OnPrepareResponse = SetCacheHeaders };
app.UseDefaultFiles();
app.UseStaticFiles(staticFiles);

app.MapWdsEndpoints();
app.MapImageEndpoints();
app.MapFallbackToFile("index.html", staticFiles);

app.Run();

// Vite fingerprints everything under /assets, so those files can be cached for good. Everything else,
// index.html above all, must be revalidated so that a new build shows up on the next page load.
static void SetCacheHeaders(StaticFileResponseContext context) =>
    context.Context.Response.Headers.CacheControl = context.Context.Request.Path.StartsWithSegments("/assets")
        ? "public, max-age=31536000, immutable"
        : "no-cache";
