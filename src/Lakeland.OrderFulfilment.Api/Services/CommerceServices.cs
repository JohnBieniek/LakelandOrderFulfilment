using System.Data;
using Lakeland.OrderFulfilment.Api.Domain;
using Lakeland.OrderFulfilment.Api.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Lakeland.OrderFulfilment.Api.Services;

public sealed class CommerceStore(CommerceDbContext db)
{
    public async Task<IReadOnlyList<Artwork>> GetArtworksAsync(CancellationToken cancellationToken) =>
        await db.Artworks.AsNoTracking().OrderBy(x => x.Title)
            .Select(x => new Artwork(x.Id, x.Title, x.Artist, x.OriginalAvailable, x.DisplayAssetId))
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<ProductCatalogEntry>> GetProductsAsync(CancellationToken cancellationToken)
    {
        var products = await db.Products.AsNoTracking().OrderBy(x => x.Name).ToListAsync(cancellationToken);
        var variants = await db.ProductVariants.AsNoTracking().OrderBy(x => x.Sku).ToListAsync(cancellationToken);
        return products.Select(product => new ProductCatalogEntry(
            new Product(product.Id, product.Name, product.Description),
            variants.Where(x => x.ProductId == product.Id).Select(MapVariant).ToArray())).ToArray();
    }

    public async Task<CustomerOrder?> FindOrderAsync(Guid id, CancellationToken cancellationToken)
    {
        var order = await db.Orders.AsNoTracking()
            .Include(x => x.Fulfillments)
            .ThenInclude(x => x.Lines)
            .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        return order is null ? null : MapOrder(order);
    }

    internal static ProductVariant MapVariant(ProductVariantEntity x) =>
        new(x.Id, x.ProductId, x.Sku, x.Name, x.RetailPrice, x.Currency, x.Provider, x.ProviderProductId, x.OriginalArtworkId);

    internal static CustomerOrder MapOrder(OrderEntity order) => new(
        order.Id,
        order.CustomerId,
        order.Status,
        order.Total,
        order.Currency,
        new ShippingAddress(order.ShippingName, order.AddressLine1, order.AddressLine2, order.City, order.Region, order.PostalCode, order.CountryCode),
        order.Fulfillments.OrderBy(x => x.Provider).Select(fulfillment => new FulfillmentGroup(
            fulfillment.Id,
            fulfillment.Provider,
            fulfillment.Status,
            fulfillment.Lines.OrderBy(x => x.Sku).Select(line => new OrderLine(
                line.Id, line.ProductVariantId, line.Sku, line.Quantity, line.RetailPrice, line.ProviderCost,
                line.AllocatedShippingCost, line.EstimatedGrossMargin, line.Currency, line.Provider)).ToArray(),
            fulfillment.ProviderOrderId,
            fulfillment.TrackingNumber,
            fulfillment.LastError)).ToArray(),
        order.CreatedAt);
}

public sealed record ProductCatalogEntry(Product Product, IReadOnlyList<ProductVariant> Variants);

public sealed class InventoryConflictException(string message, Exception? innerException = null) : Exception(message, innerException);

public sealed class OrderService(CommerceDbContext db, TimeProvider timeProvider)
{
    public async Task<CustomerOrder> CreateAsync(CreateOrderRequest request, CancellationToken cancellationToken)
    {
        if (request.Items.Count == 0) throw new ArgumentException("At least one item is required.");

        var requestedIds = request.Items.Select(x => x.ProductVariantId).Distinct().ToArray();
        var variants = await db.ProductVariants.Where(x => requestedIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, cancellationToken);
        var now = timeProvider.GetUtcNow();
        var orderId = Guid.NewGuid();
        var order = new OrderEntity
        {
            Id = orderId,
            CustomerId = request.CustomerId,
            Status = OrderStatus.PendingPayment,
            Total = 0,
            Currency = "USD",
            ShippingName = request.ShippingAddress.Name,
            AddressLine1 = request.ShippingAddress.AddressLine1,
            AddressLine2 = request.ShippingAddress.AddressLine2,
            City = request.ShippingAddress.City,
            Region = request.ShippingAddress.Region,
            PostalCode = request.ShippingAddress.PostalCode,
            CountryCode = request.ShippingAddress.CountryCode,
            CreatedAt = now
        };

        await using var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
            : null;

        try
        {
            var linesByProvider = new Dictionary<FulfillmentProviderCode, List<OrderLineEntity>>();
            foreach (var item in request.Items)
            {
                if (item.Quantity < 1 || item.Quantity > 25) throw new ArgumentException("Quantity must be between 1 and 25.");
                if (!variants.TryGetValue(item.ProductVariantId, out var variant))
                    throw new KeyNotFoundException($"Variant {item.ProductVariantId} was not found.");

                if (variant.OriginalArtworkId is Guid artworkId)
                {
                    if (item.Quantity != 1) throw new ArgumentException("Original artwork quantity must be one.");
                    var inventory = await db.OriginalInventory.SingleOrDefaultAsync(x => x.ArtworkId == artworkId, cancellationToken)
                        ?? throw new InvalidOperationException("Original artwork inventory is missing.");
                    if (inventory.Status == ArtworkAvailability.Reserved && inventory.ReservedUntil <= now)
                    {
                        inventory.Status = ArtworkAvailability.Available;
                        inventory.ReservationId = null;
                        inventory.ReservedUntil = null;
                    }
                    if (inventory.Status != ArtworkAvailability.Available)
                        throw new InventoryConflictException("The original artwork is no longer available.");
                    inventory.Status = ArtworkAvailability.Reserved;
                    inventory.ReservationId = orderId;
                    inventory.ReservedUntil = now.AddMinutes(20);
                }

                if (!linesByProvider.TryGetValue(variant.Provider, out var providerLines))
                    linesByProvider[variant.Provider] = providerLines = [];
                providerLines.Add(new OrderLineEntity
                {
                    Id = Guid.NewGuid(),
                    ProductVariantId = variant.Id,
                    Sku = variant.Sku,
                    Quantity = item.Quantity,
                    RetailPrice = variant.RetailPrice,
                    ProviderCost = 0,
                    AllocatedShippingCost = 0,
                    EstimatedGrossMargin = variant.RetailPrice,
                    Currency = variant.Currency,
                    Provider = variant.Provider
                });
                order.Total += variant.RetailPrice * item.Quantity;
            }

            foreach (var group in linesByProvider)
            {
                var fulfillment = new FulfillmentEntity
                {
                    Id = Guid.NewGuid(),
                    Provider = group.Key,
                    Status = FulfillmentStatus.PendingSubmission,
                    Lines = group.Value
                };
                order.Fulfillments.Add(fulfillment);
            }

            db.Orders.Add(order);
            await db.SaveChangesAsync(cancellationToken);
            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
            return CommerceStore.MapOrder(order);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            if (transaction is not null) await transaction.RollbackAsync(cancellationToken);
            throw new InventoryConflictException("The original artwork was reserved by another order.", exception);
        }
        catch
        {
            if (transaction is not null) await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }
}

public sealed class WebhookInbox(CommerceDbContext db)
{
    public async Task<bool> TryAcceptAsync(string provider, string externalEventId, string eventType, DateTimeOffset receivedAt, CancellationToken cancellationToken)
    {
        var normalizedProvider = provider.ToLowerInvariant();
        if (await db.WebhookReceipts.AsNoTracking().AnyAsync(
                x => x.Provider == normalizedProvider && x.ExternalEventId == externalEventId, cancellationToken))
            return false;

        db.WebhookReceipts.Add(new WebhookReceiptEntity
        {
            Id = Guid.NewGuid(),
            Provider = normalizedProvider,
            ExternalEventId = externalEventId,
            EventType = eventType,
            ReceivedAt = receivedAt
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            return false;
        }
    }
}
