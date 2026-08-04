using Lakeland.OrderFulfilment.Api.Fulfillment;
using Lakeland.OrderFulfilment.Api.Services;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks();
builder.Services.AddSingleton<CommerceStore>();
builder.Services.AddSingleton<OrderService>();
builder.Services.AddSingleton<WebhookInbox>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient<ProdigiFulfillmentProvider>(client => client.BaseAddress = new Uri("https://api.prodigi.com/"));
builder.Services.AddHttpClient<PrintfulFulfillmentProvider>(client => client.BaseAddress = new Uri("https://api.printful.com/"));
builder.Services.AddSingleton<InternalFulfillmentProvider>();
builder.Services.AddTransient<IFulfillmentProvider>(services => services.GetRequiredService<InternalFulfillmentProvider>());
builder.Services.AddTransient<IFulfillmentProvider>(services => services.GetRequiredService<ProdigiFulfillmentProvider>());
builder.Services.AddTransient<IFulfillmentProvider>(services => services.GetRequiredService<PrintfulFulfillmentProvider>());

var app = builder.Build();

if (!app.Environment.IsProduction())
{
    app.MapOpenApi();
    app.MapScalarApiReference(options => options.WithTitle("Lakeland Art Commerce API"));
}

app.UseHttpsRedirection();
app.MapHealthChecks("/health");
app.MapControllers();
app.Run();

public partial class Program;
