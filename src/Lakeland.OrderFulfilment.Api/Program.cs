using Lakeland.OrderFulfilment.Api.Fulfillment;
using Lakeland.OrderFulfilment.Api.Persistence;
using Lakeland.OrderFulfilment.Api.Services;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddDbContext<CommerceDbContext>(options =>
    options.UseNpgsql(BuildConnectionString(builder.Configuration), npgsql => npgsql.EnableRetryOnFailure(5)));
builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("postgresql");
builder.Services.AddScoped<CommerceStore>();
builder.Services.AddScoped<OrderService>();
builder.Services.AddScoped<WebhookInbox>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient<ProdigiFulfillmentProvider>(client => client.BaseAddress = new Uri("https://api.prodigi.com/"));
builder.Services.AddHttpClient<PrintfulFulfillmentProvider>(client => client.BaseAddress = new Uri("https://api.printful.com/"));
builder.Services.AddSingleton<InternalFulfillmentProvider>();
builder.Services.AddTransient<IFulfillmentProvider>(services => services.GetRequiredService<InternalFulfillmentProvider>());
builder.Services.AddTransient<IFulfillmentProvider>(services => services.GetRequiredService<ProdigiFulfillmentProvider>());
builder.Services.AddTransient<IFulfillmentProvider>(services => services.GetRequiredService<PrintfulFulfillmentProvider>());

var app = builder.Build();

if (app.Configuration.GetValue<bool>("Database:ApplyMigrations"))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<CommerceDbContext>().Database.MigrateAsync();
}

if (!app.Environment.IsProduction())
{
    app.MapOpenApi();
    app.MapScalarApiReference(options => options.WithTitle("Lakeland Art Commerce API"));
}

app.UseHttpsRedirection();
app.MapHealthChecks("/health");
app.MapControllers();
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
