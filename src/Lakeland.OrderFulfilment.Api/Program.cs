using Lakeland.OrderFulfilment.Api.Fulfillment;
using Lakeland.OrderFulfilment.Api.Persistence;
using Lakeland.OrderFulfilment.Api.Services;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Scalar.AspNetCore;
using Lakeland.OrderFulfilment.Api.Storefront;
using Microsoft.AspNetCore.RateLimiting;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddOpenApi();
var preview = builder.Configuration.GetValue<bool>("Storefront:PreviewOnly");
if (preview && !builder.Configuration.GetValue<bool>("Storefront:Enabled"))
    throw new InvalidOperationException("PreviewOnly requires Storefront:Enabled.");
builder.Services.AddDbContext<CommerceDbContext>(options => {
    if (preview) options.UseInMemoryDatabase("lakeland-beta-preview");
    else options.UseNpgsql(BuildConnectionString(builder.Configuration), npgsql => npgsql.EnableRetryOnFailure(5));
});
var health = builder.Services.AddHealthChecks();
if (!preview) health.AddCheck<DatabaseHealthCheck>("postgresql");
builder.Services.AddSingleton<StorefrontCatalog>();
builder.Services.AddSingleton<IStripeGateway, StripeGateway>();
builder.Services.AddScoped<StorefrontCheckoutService>();
builder.Services.AddRateLimiter(options => {
    options.RejectionStatusCode = 429;
    options.AddFixedWindowLimiter("checkout", policy => { policy.PermitLimit = 20; policy.Window = TimeSpan.FromMinutes(1); policy.QueueLimit = 0; });
});
builder.Services.AddScoped<CommerceStore>();
builder.Services.AddScoped<OrderService>();
builder.Services.AddScoped<WebhookInbox>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient<PrintfulFulfillmentProvider>(client => client.BaseAddress = new Uri("https://api.printful.com/"));
builder.Services.AddSingleton<InternalFulfillmentProvider>();
builder.Services.AddTransient<IFulfillmentProvider>(services => services.GetRequiredService<InternalFulfillmentProvider>());
builder.Services.AddTransient<IFulfillmentProvider>(services => services.GetRequiredService<PrintfulFulfillmentProvider>());

var app = builder.Build();

if (!preview && app.Configuration.GetValue<bool>("Database:ApplyMigrations"))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<CommerceDbContext>().Database.MigrateAsync();
}

if (app.Configuration.GetValue<bool>("Storefront:Enabled"))
{
    await using var scope = app.Services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<CommerceDbContext>();
    if (preview) await db.Database.EnsureCreatedAsync();
    await scope.ServiceProvider.GetRequiredService<StorefrontCatalog>().SeedAsync(db, CancellationToken.None);
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference(options => options.WithTitle("Lakeland Art Commerce API"));
}

app.UseHttpsRedirection();
app.Use(async (context, next) => {
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
    // The old unauthenticated order API must not expose guest orders or bypass checkout validation.
    if (context.Request.Path.StartsWithSegments("/api/orders") ||
        (context.Request.Path.StartsWithSegments("/api/shop") && !app.Configuration.GetValue<bool>("Storefront:Enabled")))
    { context.Response.StatusCode = 404; return; }
    await next();
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRateLimiter();
app.MapHealthChecks("/health");
app.MapControllers();
foreach (var route in new[] { "/", "/contact", "/gallery", "/products", "/cart", "/checkout/success" })
    app.MapGet(route, (IWebHostEnvironment env) => Results.File(Path.Combine(env.WebRootPath, "index.html"), "text/html"));
app.Run();

static string BuildConnectionString(IConfiguration configuration)
{
    if (configuration.GetConnectionString("Commerce") is { Length: > 0 } configured) return configured;

    var host = configuration["Database:Host"] ?? throw new InvalidOperationException("Database:Host must be configured outside source control.");
    var database = configuration["Database:Name"] ?? throw new InvalidOperationException("Database:Name must be configured outside source control.");
    var username = configuration["Database:Username"] ?? throw new InvalidOperationException("Database:Username must be configured outside source control.");
    var password = configuration["Database:Password"] ?? throw new InvalidOperationException("Database:Password must come from user-secrets or Key Vault.");

    return new NpgsqlConnectionStringBuilder
    {
        Host = host,
        Port = configuration.GetValue("Database:Port", 5432),
        Database = database,
        Username = username,
        Password = password,
        SslMode = SslMode.Require,
        Timeout = 15,
        CommandTimeout = 30,
        Pooling = true
    }.ConnectionString;
}

public partial class Program;
