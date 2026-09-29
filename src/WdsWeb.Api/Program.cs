using WdsWeb.Api.Endpoints;
using WdsWeb.Api.Wds;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<WdsOptions>(builder.Configuration.GetSection(WdsOptions.SectionName));
builder.Services.AddSingleton<WdsSessionPool>();
builder.Services.AddSingleton<WdsScriptRunner>();
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<WdsExceptionHandler>();

var app = builder.Build();

app.UseExceptionHandler();

// The built frontend (web/, output to wwwroot) is served from here in production. In development
// the Vite dev server serves it instead and proxies /api to this service.
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapWdsEndpoints();
app.MapFallbackToFile("index.html");

app.Run();
