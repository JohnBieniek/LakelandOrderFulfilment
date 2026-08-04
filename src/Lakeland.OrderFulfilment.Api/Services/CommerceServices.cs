using System.Collections.Concurrent;
using Lakeland.OrderFulfilment.Api.Domain;

namespace Lakeland.OrderFulfilment.Api.Services;

public sealed class CommerceStore
{
    private readonly ConcurrentDictionary<Guid, CustomerOrder> orders = new();
    private readonly ConcurrentDictionary<Guid, OriginalArtworkInventory> inventory = new();

    public CommerceStore()
    {
        var artId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        Artworks = [new Artwork(artId, "Sample Lake Study", "Portfolio Artist", true, "display/sample-lake-study.webp")];
        Products = [
            new Product(Guid.Parse("11111111-1111-1111-1111-111111111111"), "Original artwork", "One-of-one artwork fulfilled by the studio."),
            new Product(Guid.Parse("22222222-2222-2222-2222-222222222222"), "Fine-art print", "Archival reproduction fulfilled by Prodigi."),
            new Product(Guid.Parse("33333333-3333-3333-3333-333333333333"), "Art T-shirt", "Apparel fulfilled by Printful.")];
        Variants = [
            new ProductVariant(Guid.Parse("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), Products[0].Id, "ORIGINAL-SAMPLE-LAKE", "Original", 1200m, "USD", FulfillmentProviderCode.Internal, "internal", artId),
            new ProductVariant(Guid.Parse("22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), Products[1].Id, "PRINT-SAMPLE-LAKE-8X10", "8 x 10", 38m, "USD", FulfillmentProviderCode.Prodigi, "CONFIGURE_PRODIGI_MAPPING"),
            new ProductVariant(Guid.Parse("33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), Products[2].Id, "SHIRT-SAMPLE-LAKE-M", "Medium", 32m, "USD", FulfillmentProviderCode.Printful, "CONFIGURE_PRINTFUL_MAPPING")];
        inventory[artId] = new OriginalArtworkInventory(artId);
    }

    public IReadOnlyList<Artwork> Artworks { get; }
    public IReadOnlyList<Product> Products { get; }
    public IReadOnlyList<ProductVariant> Variants { get; }
    public ProductVariant? FindVariant(Guid id) => Variants.FirstOrDefault(x => x.Id == id);
    public OriginalArtworkInventory? FindInventory(Guid artworkId) => inventory.GetValueOrDefault(artworkId);
    public void Save(CustomerOrder order) => orders[order.Id] = order;
    public CustomerOrder? FindOrder(Guid id) => orders.GetValueOrDefault(id);
}

public sealed class OrderService(CommerceStore store, TimeProvider timeProvider)
{
    public CustomerOrder Create(CreateOrderRequest request)
    {
        if (request.Items.Count == 0) throw new ArgumentException("At least one item is required.");
        var orderId = Guid.NewGuid();
        var lines = new List<OrderLine>();
        var reservations = new List<(OriginalArtworkInventory Inventory, Guid ReservationId)>();
        try
        {
            foreach (var item in request.Items)
            {
                if (item.Quantity < 1 || item.Quantity > 25) throw new ArgumentException("Quantity must be between 1 and 25.");
                var variant = store.FindVariant(item.ProductVariantId) ?? throw new KeyNotFoundException($"Variant {item.ProductVariantId} was not found.");
                if (variant.OriginalArtworkId is Guid artworkId)
                {
                    if (item.Quantity != 1) throw new ArgumentException("Original artwork quantity must be one.");
                    var original = store.FindInventory(artworkId) ?? throw new InvalidOperationException("Original artwork inventory is missing.");
                    if (!original.TryReserve(orderId, timeProvider.GetUtcNow(), TimeSpan.FromMinutes(20))) throw new InvalidOperationException("The original artwork is no longer available.");
                    reservations.Add((original, orderId));
                }
                lines.Add(new OrderLine(Guid.NewGuid(), variant.Id, variant.Sku, item.Quantity, variant.RetailPrice, 0, 0, variant.RetailPrice, variant.Currency, variant.Provider));
            }
            var groups = lines.GroupBy(x => x.Provider).Select(group => new FulfillmentGroup(Guid.NewGuid(), group.Key, FulfillmentStatus.PendingSubmission, group.ToArray())).ToArray();
            var order = new CustomerOrder(orderId, request.CustomerId, OrderStatus.PendingPayment, lines.Sum(x => x.RetailPrice * x.Quantity), "USD", request.ShippingAddress, groups, timeProvider.GetUtcNow());
            store.Save(order);
            return order;
        }
        catch
        {
            foreach (var reservation in reservations) reservation.Inventory.Release(reservation.ReservationId);
            throw;
        }
    }
}

public sealed record WebhookReceipt(string Provider, string ExternalEventId, string EventType, DateTimeOffset ReceivedAt);
public sealed class WebhookInbox
{
    private readonly ConcurrentDictionary<string, WebhookReceipt> events = new(StringComparer.OrdinalIgnoreCase);
    public bool TryAccept(string provider, string externalEventId, string eventType, DateTimeOffset receivedAt) => events.TryAdd($"{provider}:{externalEventId}", new WebhookReceipt(provider, externalEventId, eventType, receivedAt));
}
