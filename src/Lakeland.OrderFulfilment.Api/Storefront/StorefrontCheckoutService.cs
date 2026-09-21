using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lakeland.OrderFulfilment.Api.Domain;
using Lakeland.OrderFulfilment.Api.Persistence;
using Lakeland.OrderFulfilment.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Lakeland.OrderFulfilment.Api.Storefront;

public sealed record ShopCheckoutRequest(Guid RequestId, IReadOnlyList<CreateOrderItemRequest> Items);

public sealed class StorefrontCheckoutService(CommerceDbContext db, StorefrontCatalog catalog, IStripeGateway stripe, TimeProvider clock)
{
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public async Task<StripeCheckout> CreateAsync(ShopCheckoutRequest request, string ownerHash, CancellationToken token)
    {
        if (!stripe.Ready) throw new InvalidOperationException("Stripe test checkout is not configured yet.");
        if (request.RequestId == Guid.Empty) throw new ArgumentException("A checkout request ID is required.");
        var items = catalog.Validate(request.Items);
        var cartHash = Hash(string.Join("|", items.Select(i => $"{i.Product.Id}:{i.Quantity}")));
        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, token) : null;
            var prior = await db.StorefrontCheckouts.SingleOrDefaultAsync(x => x.Id == request.RequestId, token);
            if (prior is not null)
            {
                if (prior.OwnerHash != ownerHash || prior.CartHash != cartHash) throw new ArgumentException("This checkout request cannot be reused for this cart.");
                return;
            }
            var now = clock.GetUtcNow();
            var order = new OrderEntity { Id = request.RequestId, CustomerId = Guid.NewGuid(), Status = OrderStatus.PendingPayment,
                Total = items.Sum(i => i.Product.Price * i.Quantity), Currency = "USD", CreatedAt = now,
                ShippingName = "Collected by Stripe", AddressLine1 = "", City = "", Region = "", PostalCode = "", CountryCode = "US" };
            foreach (var item in items.Where(i => i.Product.IsOriginal))
            {
                var inventory = await db.OriginalInventory.SingleAsync(x => x.ArtworkId == item.Product.Id, token);
                // Never release a Stripe reservation just because local time elapsed. Only a verified expiry can release it.
                if (inventory.Status != ArtworkAvailability.Available) throw new InventoryConflictException("That original is reserved or sold. Please remove it from your cart.");
                inventory.Status = ArtworkAvailability.Reserved;
                inventory.ReservationId = order.Id;
                inventory.ReservedUntil = now.AddMinutes(45);
            }
            foreach (var group in items.GroupBy(i => i.Product.Provider))
                order.Fulfillments.Add(new FulfillmentEntity { Id = Guid.NewGuid(), Provider = group.Key, Status = FulfillmentStatus.PendingSubmission,
                    Lines = group.Select(i => new OrderLineEntity { Id = Guid.NewGuid(), ProductVariantId = i.Product.Id,
                        Sku = $"BETA-{i.Product.Id:N}", Quantity = i.Quantity, RetailPrice = i.Product.Price,
                        Currency = "USD", Provider = group.Key, EstimatedGrossMargin = 0 }).ToList() });
            db.Orders.Add(order);
            db.StorefrontCheckouts.Add(new StorefrontCheckoutEntity { Id = order.Id, OwnerHash = ownerHash, CartHash = cartHash, ExpiresAt = now.AddMinutes(45) });
            await db.SaveChangesAsync(token);
            if (transaction is not null) await transaction.CommitAsync(token);
        });

        var checkout = await db.StorefrontCheckouts.SingleAsync(x => x.Id == request.RequestId, token);
        if (checkout.ExpiresAt <= clock.GetUtcNow()) throw new InventoryConflictException("This checkout has expired. Start a new checkout; reserved originals await Stripe expiry confirmation.");
        if (checkout.SessionId is not null) return new StripeCheckout(checkout.SessionId, checkout.SessionUrl!);
        // The persisted order is authoritative on retries, even if the catalog changes after the first request.
        var savedOrder = await db.Orders.Include(o => o.Fulfillments).ThenInclude(f => f.Lines).SingleAsync(o => o.Id == checkout.Id, token);
        var lines = savedOrder.Fulfillments.SelectMany(f => f.Lines).Select(l => new CheckoutLine(
            catalog.Products.Single(p => p.Id == l.ProductVariantId).Name, checked((long)(l.RetailPrice * 100)), l.Quantity)).ToArray();
        var session = await stripe.CreateAsync(checkout.Id, lines, checkout.ExpiresAt, token);
        checkout.SessionId = session.Id;
        checkout.SessionUrl = session.Url;
        await db.SaveChangesAsync(token);
        return session;
    }

    public async Task ApplyStripeEventAsync(JsonElement root, CancellationToken token)
    {
        if (root.GetProperty("livemode").GetBoolean()) throw new ArgumentException("Live events are not accepted by beta.");
        var eventId = root.GetProperty("id").GetString()!;
        var eventType = root.GetProperty("type").GetString()!;
        if (eventType is not ("checkout.session.completed" or "checkout.session.expired")) return;
        var session = root.GetProperty("data").GetProperty("object");
        if (!session.TryGetProperty("metadata", out var metadata) || !metadata.TryGetProperty("environment", out var environment) || environment.GetString() != "beta") return;
        if (!Guid.TryParse(session.GetProperty("client_reference_id").GetString(), out var orderId)) throw new ArgumentException("Missing order reference.");
        await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, token) : null;
            if (await db.WebhookReceipts.AnyAsync(x => x.Provider == "stripe" && x.ExternalEventId == eventId, token)) return;
            var checkout = await db.StorefrontCheckouts.SingleAsync(x => x.Id == orderId, token);
            var sessionId = session.GetProperty("id").GetString();
            if (checkout.SessionId is not null && checkout.SessionId != sessionId) throw new ArgumentException("Checkout session mismatch.");
            var order = await db.Orders.SingleAsync(o => o.Id == orderId, token);
            var inventory = await db.OriginalInventory.Where(i => i.ReservationId == orderId).ToListAsync(token);
            if (eventType == "checkout.session.completed")
            {
                if (session.GetProperty("payment_status").GetString() != "paid") return;
                if (session.GetProperty("amount_total").GetInt64() != checked((long)(order.Total * 100)) || session.GetProperty("currency").GetString() != "usd")
                    throw new ArgumentException("Payment amount does not match the order.");
                if (order.Status == OrderStatus.Canceled) throw new InvalidOperationException("A paid event arrived for a canceled order; manual reconciliation is required.");
                if (order.Status == OrderStatus.PendingPayment)
                {
                    order.Status = OrderStatus.Paid;
                    foreach (var item in inventory) { item.Status = ArtworkAvailability.Sold; item.ReservationId = null; item.ReservedUntil = null; }
                    // Test-only outbox entry: no production provider submission is triggered from the beta.
                    db.OutboxMessages.Add(new OutboxMessageEntity { Id = Guid.NewGuid(), Type = "BetaPaymentRecorded", Payload = JsonSerializer.Serialize(new { orderId }), OccurredAt = clock.GetUtcNow() });
                }
            }
            else if (order.Status == OrderStatus.PendingPayment)
            {
                order.Status = OrderStatus.Canceled;
                foreach (var item in inventory) { item.Status = ArtworkAvailability.Available; item.ReservationId = null; item.ReservedUntil = null; }
            }
            checkout.SessionId ??= sessionId;
            db.WebhookReceipts.Add(new WebhookReceiptEntity { Id = Guid.NewGuid(), Provider = "stripe", ExternalEventId = eventId, EventType = eventType, ReceivedAt = clock.GetUtcNow(), ProcessedAt = clock.GetUtcNow() });
            await db.SaveChangesAsync(token);
            if (transaction is not null) await transaction.CommitAsync(token);
        });
    }
}
