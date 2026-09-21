using System.Text.Json;
using Lakeland.OrderFulfilment.Api.Domain;
using Lakeland.OrderFulfilment.Api.Persistence;
using Lakeland.OrderFulfilment.Api.Services;
using Lakeland.OrderFulfilment.Api.Storefront;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Lakeland.OrderFulfilment.Api.Controllers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Security.Cryptography;
using System.Text;

namespace Lakeland.OrderFulfilment.Tests;

public sealed class StorefrontTests
{
    private static readonly StorefrontCatalog Catalog = new(TimeProvider.System);

    [Fact]
    public void Ship_estimates_skip_weekends_and_distinguish_made_to_order()
    {
        Assert.Equal(new DateOnly(2026, 9, 22), StorefrontCatalog.AddBusinessDays(new DateOnly(2026, 9, 18), 2));
        var original = Catalog.Products.First(p => p.Kind == "original");
        var clay = Catalog.Products.First(p => p.Kind == "clay");
        Assert.True(Catalog.Estimate(clay).Earliest > Catalog.Estimate(original).Latest);
    }

    [Fact]
    public void Fan_art_and_unknown_variants_are_not_purchasable()
    {
        Assert.All(Catalog.Gallery.Where(w => w.FanArt), w => Assert.Null(w.ProductId));
        Assert.Throws<ArgumentException>(() => Catalog.Validate([new(Guid.NewGuid(), 1)]));
    }

    [Fact]
    public void Duplicate_original_lines_cannot_bypass_quantity_limit()
    {
        var original = Catalog.Products.First(p => p.IsOriginal);
        Assert.Throws<ArgumentException>(() => Catalog.Validate([new(original.Id, 1), new(original.Id, 1)]));
        Assert.Throws<ArgumentException>(() => Catalog.Validate([new(original.Id, 0)]));
    }

    [Fact]
    public void Stripe_beta_refuses_live_keys_and_requires_webhook_configuration()
    {
        IConfiguration Config(string key, string? webhook) => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
            ["Payments:StripeSecretKey"] = key, ["Payments:StripeWebhookSecret"] = webhook, ["Storefront:PublicUrl"] = "https://beta.example.test"
        }).Build();
        Assert.False(new StripeGateway(Config("sk_live_example", "whsec_example")).Ready);
        Assert.False(new StripeGateway(Config("sk_test_example", null)).Ready);
        Assert.True(new StripeGateway(Config("sk_test_example", "whsec_example")).Ready);
    }

    [Fact]
    public async Task Checkout_uses_server_prices_and_retries_reuse_the_same_session()
    {
        await using var db = await Database();
        var stripe = new FakeStripe();
        var service = new StorefrontCheckoutService(db, Catalog, stripe, TimeProvider.System);
        var request = new ShopCheckoutRequest(Guid.NewGuid(), Catalog.Products.Where(p => p.Kind is "original" or "printful").Select(p => new CreateOrderItemRequest(p.Id, 1)).ToArray());
        var first = await service.CreateAsync(request, "owner", default);
        var second = await service.CreateAsync(request, "owner", default);
        Assert.Equal(first, second);
        Assert.Equal(1, stripe.Calls);
        Assert.Equal(Catalog.Products.Where(p => p.Kind is "original" or "printful").Sum(p => p.Price), stripe.Lines.Sum(l => l.UnitAmount * l.Quantity) / 100m);
        Assert.Equal(2, await db.Fulfillments.CountAsync());
        Assert.Equal(OrderStatus.PendingPayment, (await db.Orders.SingleAsync()).Status);
    }

    [Fact]
    public async Task Different_owner_cannot_reuse_checkout_and_original_cannot_be_reserved_twice()
    {
        await using var db = await Database();
        var service = new StorefrontCheckoutService(db, Catalog, new FakeStripe(), TimeProvider.System);
        var request = new ShopCheckoutRequest(Guid.NewGuid(), [new(Catalog.Products.First(p => p.IsOriginal).Id, 1)]);
        await service.CreateAsync(request, "owner", default);
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(request, "other-owner", default));
        await Assert.ThrowsAsync<InventoryConflictException>(() => service.CreateAsync(request with { RequestId = Guid.NewGuid() }, "other-owner", default));
    }

    [Fact]
    public async Task Paid_webhook_is_deduplicated_and_outbox_is_recorded_once()
    {
        await using var db = await Database();
        var service = new StorefrontCheckoutService(db, Catalog, new FakeStripe(), TimeProvider.System);
        var original = Catalog.Products.First(p => p.IsOriginal);
        var request = new ShopCheckoutRequest(Guid.NewGuid(), [new(original.Id, 1)]);
        await service.CreateAsync(request, "owner", default);
        var payload = Event(request.RequestId, "checkout.session.completed", (long)(original.Price * 100));
        await service.ApplyStripeEventAsync(payload, default);
        await service.ApplyStripeEventAsync(payload, default);
        await service.ApplyStripeEventAsync(Event(request.RequestId, "checkout.session.completed", (long)(original.Price * 100), "evt_second"), default);
        Assert.Equal(OrderStatus.Paid, (await db.Orders.SingleAsync()).Status);
        Assert.Equal(ArtworkAvailability.Sold, (await db.OriginalInventory.SingleAsync(i => i.ArtworkId == original.Id)).Status);
        Assert.Single(await db.OutboxMessages.ToListAsync());
    }

    [Fact]
    public async Task Expired_webhook_releases_original_but_never_reverses_paid_order()
    {
        await using var db = await Database();
        var service = new StorefrontCheckoutService(db, Catalog, new FakeStripe(), TimeProvider.System);
        var original = Catalog.Products.First(p => p.IsOriginal);
        var request = new ShopCheckoutRequest(Guid.NewGuid(), [new(original.Id, 1)]);
        await service.CreateAsync(request, "owner", default);
        await service.ApplyStripeEventAsync(Event(request.RequestId, "checkout.session.expired", 0), default);
        Assert.Equal(ArtworkAvailability.Available, (await db.OriginalInventory.SingleAsync(i => i.ArtworkId == original.Id)).Status);
        Assert.Equal(OrderStatus.Canceled, (await db.Orders.SingleAsync()).Status);
        var second = request with { RequestId = Guid.NewGuid() };
        await service.CreateAsync(second, "owner", default);
        await service.ApplyStripeEventAsync(Event(second.RequestId, "checkout.session.completed", (long)(original.Price * 100), "evt_paid"), default);
        await service.ApplyStripeEventAsync(Event(second.RequestId, "checkout.session.expired", 0, "evt_late"), default);
        Assert.Equal(OrderStatus.Paid, (await db.Orders.SingleAsync(o => o.Id == second.RequestId)).Status);
    }

    [Fact]
    public async Task Webhook_controller_rejects_tampering_and_accepts_signed_test_payment()
    {
        await using var db = await Database();
        var stripe = new FakeStripe();
        var service = new StorefrontCheckoutService(db, Catalog, stripe, TimeProvider.System);
        var product = Catalog.Products.Last();
        var request = new ShopCheckoutRequest(Guid.NewGuid(), [new(product.Id, 1)]);
        await service.CreateAsync(request, "owner", default);
        var raw = Event(request.RequestId, "checkout.session.completed", (long)(product.Price * 100)).GetRawText();
        const string signingSecret = "whsec_example_for_unit_tests";
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var signature = Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(signingSecret), Encoding.UTF8.GetBytes($"{timestamp}.{raw}"))).ToLowerInvariant();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Payments:StripeWebhookSecret"] = signingSecret }).Build();
        var context = new DefaultHttpContext();
        context.Request.Headers["Stripe-Signature"] = $"t={timestamp},v1={signature}";
        context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(raw + " "));
        var controller = new StorefrontController(Catalog, db, stripe, service, config) { ControllerContext = new ControllerContext { HttpContext = context } };
        Assert.IsType<BadRequestResult>(await controller.StripeWebhook(default));
        Assert.Equal(OrderStatus.PendingPayment, (await db.Orders.SingleAsync()).Status);
        context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(raw));
        Assert.IsType<OkResult>(await controller.StripeWebhook(default));
        Assert.Equal(OrderStatus.Paid, (await db.Orders.SingleAsync()).Status);
    }

    [Fact]
    public async Task Wrong_payment_amount_does_not_mark_order_paid()
    {
        await using var db = await Database();
        var service = new StorefrontCheckoutService(db, Catalog, new FakeStripe(), TimeProvider.System);
        var request = new ShopCheckoutRequest(Guid.NewGuid(), [new(Catalog.Products.Last().Id, 1)]);
        await service.CreateAsync(request, "owner", default);
        await Assert.ThrowsAsync<ArgumentException>(() => service.ApplyStripeEventAsync(Event(request.RequestId, "checkout.session.completed", 1), default));
        Assert.Equal(OrderStatus.PendingPayment, (await db.Orders.SingleAsync()).Status);
        Assert.Empty(await db.OutboxMessages.ToListAsync());
    }

    private static JsonElement Event(Guid orderId, string type, long amount, string eventId = "evt_test") => JsonSerializer.SerializeToElement(new {
        id = eventId, type, livemode = false, data = new { @object = new { id = "cs_test_" + orderId, client_reference_id = orderId.ToString(),
            payment_status = "paid", amount_total = amount, currency = "usd", metadata = new { environment = "beta" } } }
    });

    private static async Task<CommerceDbContext> Database()
    {
        var db = new CommerceDbContext(new DbContextOptionsBuilder<CommerceDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        await db.Database.EnsureCreatedAsync(); await Catalog.SeedAsync(db, default); return db;
    }

    private sealed class FakeStripe : IStripeGateway
    {
        public bool Ready => true;
        public int Calls { get; private set; }
        public IReadOnlyList<CheckoutLine> Lines { get; private set; } = [];
        public Task<StripeCheckout> CreateAsync(Guid orderId, IReadOnlyList<CheckoutLine> lines, DateTimeOffset expires, CancellationToken token)
        { Calls++; Lines = lines; return Task.FromResult(new StripeCheckout("cs_test_" + orderId, "https://checkout.stripe.com/test")); }
    }
}
