using Lakeland.OrderFulfilment.Api.Domain;
using Lakeland.OrderFulfilment.Api.Services;

namespace Lakeland.OrderFulfilment.Tests;

public sealed class CommerceTests
{
    private static ShippingAddress Address => new("Test Customer", "1 Test Way", null, "Lakeland", "FL", "33801", "US");

    [Fact]
    public void Mixed_order_is_split_by_provider()
    {
        var store = new CommerceStore();
        var service = new OrderService(store, TimeProvider.System);
        var order = service.Create(new CreateOrderRequest(Guid.NewGuid(), store.Variants.Select(x => new CreateOrderItemRequest(x.Id, 1)).ToArray(), Address));
        Assert.Equal(3, order.Fulfillments.Count);
        Assert.Equal(
            new[] { FulfillmentProviderCode.Internal, FulfillmentProviderCode.Prodigi, FulfillmentProviderCode.Printful },
            order.Fulfillments.Select(x => x.Provider).Order().ToArray());
    }

    [Fact]
    public void Original_artwork_cannot_be_reserved_twice()
    {
        var store = new CommerceStore();
        var service = new OrderService(store, TimeProvider.System);
        var original = store.Variants.Single(x => x.Provider == FulfillmentProviderCode.Internal);
        service.Create(new CreateOrderRequest(Guid.NewGuid(), [new(original.Id, 1)], Address));
        Assert.Throws<InvalidOperationException>(() => service.Create(new CreateOrderRequest(Guid.NewGuid(), [new(original.Id, 1)], Address)));
    }

    [Fact]
    public void Duplicate_webhook_is_ignored()
    {
        var inbox = new WebhookInbox();
        Assert.True(inbox.TryAccept("stripe", "evt_123", "checkout.completed", DateTimeOffset.UtcNow));
        Assert.False(inbox.TryAccept("stripe", "evt_123", "checkout.completed", DateTimeOffset.UtcNow));
    }
}
