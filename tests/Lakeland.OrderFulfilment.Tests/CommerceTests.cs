using Lakeland.OrderFulfilment.Api.Domain;
using Lakeland.OrderFulfilment.Api.Persistence;
using Lakeland.OrderFulfilment.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Lakeland.OrderFulfilment.Tests;

public sealed class CommerceTests
{
    private static ShippingAddress Address => new("Test Customer", "1 Test Way", null, "Lakeland", "FL", "33801", "US");

    [Fact]
    public async Task Mixed_order_is_split_by_provider_and_can_be_reloaded()
    {
        await using var db = await CreateDatabaseAsync();
        var store = new CommerceStore(db);
        var service = new OrderService(db, TimeProvider.System);
        var products = await store.GetProductsAsync(CancellationToken.None);
        var requestItems = products.SelectMany(x => x.Variants).Select(x => new CreateOrderItemRequest(x.Id, 1)).ToArray();

        var order = await service.CreateAsync(
            new CreateOrderRequest(Guid.NewGuid(), requestItems, Address), CancellationToken.None);
        db.ChangeTracker.Clear();
        var reloaded = await store.FindOrderAsync(order.Id, CancellationToken.None);

        Assert.NotNull(reloaded);
        Assert.Equal(3, reloaded.Fulfillments.Count);
        Assert.Equal(
            new[] { FulfillmentProviderCode.Internal, FulfillmentProviderCode.Prodigi, FulfillmentProviderCode.Printful },
            reloaded.Fulfillments.Select(x => x.Provider).Order().ToArray());
    }

    [Fact]
    public async Task Original_artwork_cannot_be_reserved_twice()
    {
        await using var db = await CreateDatabaseAsync();
        var store = new CommerceStore(db);
        var service = new OrderService(db, TimeProvider.System);
        var products = await store.GetProductsAsync(CancellationToken.None);
        var original = products.SelectMany(x => x.Variants).Single(x => x.Provider == FulfillmentProviderCode.Internal);

        await service.CreateAsync(
            new CreateOrderRequest(Guid.NewGuid(), [new(original.Id, 1)], Address), CancellationToken.None);

        await Assert.ThrowsAsync<InventoryConflictException>(() => service.CreateAsync(
            new CreateOrderRequest(Guid.NewGuid(), [new(original.Id, 1)], Address), CancellationToken.None));
    }

    [Fact]
    public async Task Duplicate_webhook_is_ignored_and_receipt_is_persisted()
    {
        await using var db = await CreateDatabaseAsync();
        var inbox = new WebhookInbox(db);
        var now = DateTimeOffset.UtcNow;

        Assert.True(await inbox.TryAcceptAsync("stripe", "evt_123", "checkout.completed", now, CancellationToken.None));
        Assert.False(await inbox.TryAcceptAsync("stripe", "evt_123", "checkout.completed", now, CancellationToken.None));
        Assert.Equal(1, await db.WebhookReceipts.CountAsync(CancellationToken.None));
    }

    private static async Task<CommerceDbContext> CreateDatabaseAsync()
    {
        var options = new DbContextOptionsBuilder<CommerceDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new CommerceDbContext(options);
        await db.Database.EnsureCreatedAsync(CancellationToken.None);
        return db;
    }
}
