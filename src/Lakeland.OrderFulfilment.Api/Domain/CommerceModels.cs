namespace Lakeland.OrderFulfilment.Api.Domain;

public enum FulfillmentProviderCode { Internal, Prodigi, Printful }
public enum OrderStatus { PendingPayment, Paid, PartiallyInProduction, PartiallyShipped, Completed, PartiallyCanceled, Canceled }
public enum FulfillmentStatus { PendingSubmission, Submitted, Accepted, InProduction, Shipped, Delivered, Failed, Canceled }
public enum ArtworkAvailability { Available, Reserved, Sold, Packing, Shipped, Delivered, Returned }

public sealed record Artwork(Guid Id, string Title, string Artist, bool OriginalAvailable, string DisplayAssetId);
public sealed record Product(Guid Id, string Name, string Description);
public sealed record ProductVariant(Guid Id, Guid ProductId, string Sku, string Name, decimal RetailPrice, string Currency,
    FulfillmentProviderCode Provider, string ProviderProductId, Guid? OriginalArtworkId = null);
public sealed record ShippingAddress(string Name, string AddressLine1, string? AddressLine2, string City, string Region, string PostalCode, string CountryCode);
public sealed record CreateOrderItemRequest(Guid ProductVariantId, int Quantity);
public sealed record CreateOrderRequest(Guid CustomerId, IReadOnlyList<CreateOrderItemRequest> Items, ShippingAddress ShippingAddress);
public sealed record OrderLine(Guid Id, Guid ProductVariantId, string Sku, int Quantity, decimal RetailPrice, decimal ProviderCost,
    decimal AllocatedShippingCost, decimal EstimatedGrossMargin, string Currency, FulfillmentProviderCode Provider);
public sealed record FulfillmentGroup(Guid Id, FulfillmentProviderCode Provider, FulfillmentStatus Status, IReadOnlyList<OrderLine> Lines,
    string? ProviderOrderId = null, string? TrackingNumber = null, string? LastError = null);
public sealed record CustomerOrder(Guid Id, Guid CustomerId, OrderStatus Status, decimal Total, string Currency,
    ShippingAddress ShippingAddress, IReadOnlyList<FulfillmentGroup> Fulfillments, DateTimeOffset CreatedAt);

public sealed class OriginalArtworkInventory
{
    private readonly object gate = new();
    public OriginalArtworkInventory(Guid artworkId) => ArtworkId = artworkId;
    public Guid ArtworkId { get; }
    public ArtworkAvailability Status { get; private set; } = ArtworkAvailability.Available;
    public Guid? ReservationId { get; private set; }
    public DateTimeOffset? ReservedUntil { get; private set; }
    public long Version { get; private set; }

    public bool TryReserve(Guid reservationId, DateTimeOffset now, TimeSpan duration)
    {
        lock (gate)
        {
            if (Status == ArtworkAvailability.Reserved && ReservedUntil <= now) ReleaseUnsafe();
            if (Status != ArtworkAvailability.Available) return false;
            Status = ArtworkAvailability.Reserved;
            ReservationId = reservationId;
            ReservedUntil = now.Add(duration);
            Version++;
            return true;
        }
    }

    public bool ConfirmSale(Guid reservationId)
    {
        lock (gate)
        {
            if (Status != ArtworkAvailability.Reserved || ReservationId != reservationId) return false;
            Status = ArtworkAvailability.Sold;
            ReservationId = null;
            ReservedUntil = null;
            Version++;
            return true;
        }
    }

    public void Release(Guid reservationId)
    {
        lock (gate) { if (ReservationId == reservationId) ReleaseUnsafe(); }
    }

    private void ReleaseUnsafe()
    {
        Status = ArtworkAvailability.Available;
        ReservationId = null;
        ReservedUntil = null;
        Version++;
    }
}
