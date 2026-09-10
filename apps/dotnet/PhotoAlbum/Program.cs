using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using PhotoAlbum.Data;
using PhotoAlbum.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorPages();

// Authentication/authorization: the gallery is public, but state-changing
// operations (photo delete) require an authenticated admin (CWE-306).
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.LoginPath = "/Login";
        options.AccessDeniedPath = "/Login";
    });
builder.Services.AddAuthorization();

// Add DbContext
builder.Services.AddDbContext<PhotoAlbumContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

// Register PhotoService
builder.Services.AddScoped<IPhotoService, PhotoService>();

// Configure form options for file uploads
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 10485760; // 10MB
    options.ValueLengthLimit = 10485760;
    options.MultipartBoundaryLengthLimit = 128;
});

var app = builder.Build();

// Ensure uploads directory exists
var uploadsPath = Path.Combine(app.Environment.ContentRootPath, "wwwroot", "uploads");
if (!Directory.Exists(uploadsPath))
{
    Directory.CreateDirectory(uploadsPath);
}

// Run database migrations on startup in all environments (skip only when flagged as test)
var isTestEnvironment = app.Configuration.GetValue<bool>("IsTestEnvironment");
if (!isTestEnvironment)
{
    try
    {
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<PhotoAlbumContext>();
        await context.Database.MigrateAsync();
    }
    catch (Exception ex)
    {
        // Log and rethrow to fail fast if migrations cannot be applied
        Console.WriteLine($"Database migration failed: {ex}");
        throw;
    }
}

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

// Container readiness probes reach the application directly over HTTP.
app.UseWhen(context => !context.Request.Path.Equals("/health"),
    branch => branch.UseHttpsRedirection());

// Enable static files with cache headers
app.UseStaticFiles(new Microsoft.AspNetCore.Builder.StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        // Cache static files for 1 hour
        ctx.Context.Response.Headers.Append("Cache-Control", "public,max-age=3600");
    }
});

app.UseRouting();

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", async (PhotoAlbumContext context, HttpContext http, CancellationToken cancellationToken) =>
{
    http.Response.Headers.CacheControl = "no-store";
    try
    {
        var ready = await context.Database.CanConnectAsync(cancellationToken);
        return Results.Json(new { status = ready ? "ok" : "unhealthy" },
            statusCode: ready ? StatusCodes.Status200OK : StatusCodes.Status503ServiceUnavailable);
    }
    catch (Exception)
    {
        return Results.Json(new { status = "unhealthy" },
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
}).AllowAnonymous();

app.MapStaticAssets();
app.MapRazorPages()
   .WithStaticAssets();

app.Run();

// Make the implicit Program class public for testing
public partial class Program { }
