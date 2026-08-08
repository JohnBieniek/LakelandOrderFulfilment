using Lakeland.OrderFulfilment.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Lakeland.OrderFulfilment.Api.Persistence;

public sealed class CommerceDbContext(DbContextOptions<CommerceDbContext> options) : DbContext(options)
{
    public DbSet<ArtworkEntity> Artworks => Set<ArtworkEntity>();
    public DbSet<ProductEntity> Products => Set<ProductEntity>();
    public DbSet<ProductVariantEntity> ProductVariants => Set<ProductVariantEntity>();
    public DbSet<OriginalInventoryEntity> OriginalInventory => Set<OriginalInventoryEntity>();
    public DbSet<OrderEntity> Orders => Set<OrderEntity>();
    public DbSet<FulfillmentEntity> Fulfillments => Set<FulfillmentEntity>();
    public DbSet<OrderLineEntity> OrderLines => Set<OrderLineEntity>();
    public DbSet<WebhookReceiptEntity> WebhookReceipts => Set<WebhookReceiptEntity>();
    public DbSet<OutboxMessageEntity> OutboxMessages => Set<OutboxMessageEntity>();
    public DbSet<FailureHistoryEntity> FailureHistory => Set<FailureHistoryEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var artwork = modelBuilder.Entity<ArtworkEntity>();
        artwork.ToTable("artworks");
        artwork.HasKey(x => x.Id);
        artwork.Property(x => x.Title).HasMaxLength(200);
        artwork.Property(x => x.Artist).HasMaxLength(200);
        artwork.Property(x => x.DisplayAssetId).HasMaxLength(500);

        var product = modelBuilder.Entity<ProductEntity>();
        product.ToTable("products");
        product.HasKey(x => x.Id);
        product.Property(x => x.Name).HasMaxLength(200);
        product.Property(x => x.Description).HasMaxLength(2000);

        var variant = modelBuilder.Entity<ProductVariantEntity>();
        variant.ToTable("product_variants");
        variant.HasKey(x => x.Id);
        variant.HasIndex(x => x.Sku).IsUnique();
        variant.Property(x => x.Sku).HasMaxLength(100);
        variant.Property(x => x.Name).HasMaxLength(200);
        variant.Property(x => x.RetailPrice).HasPrecision(18, 2);
        variant.Property(x => x.Currency).HasMaxLength(3);
        variant.Property(x => x.Provider).HasConversion<string>().HasMaxLength(32);
        variant.Property(x => x.ProviderProductId).HasMaxLength(200);
        variant.HasOne<ProductEntity>().WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Restrict);
        variant.HasOne<ArtworkEntity>().WithMany().HasForeignKey(x => x.OriginalArtworkId).OnDelete(DeleteBehavior.Restrict);

        var inventory = modelBuilder.Entity<OriginalInventoryEntity>();
        inventory.ToTable("original_inventory");
        inventory.HasKey(x => x.ArtworkId);
        inventory.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
        inventory.Property(x => x.Version).IsRowVersion();
        inventory.HasOne<ArtworkEntity>().WithOne().HasForeignKey<OriginalInventoryEntity>(x => x.ArtworkId).OnDelete(DeleteBehavior.Restrict);

        var order = modelBuilder.Entity<OrderEntity>();
        order.ToTable("orders");
        order.HasKey(x => x.Id);
        order.HasIndex(x => new { x.CustomerId, x.CreatedAt });
        order.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
        order.Property(x => x.Total).HasPrecision(18, 2);
        order.Property(x => x.Currency).HasMaxLength(3);
        order.Property(x => x.ShippingName).HasMaxLength(200);
        order.Property(x => x.AddressLine1).HasMaxLength(200);
        order.Property(x => x.AddressLine2).HasMaxLength(200);
        order.Property(x => x.City).HasMaxLength(100);
        order.Property(x => x.Region).HasMaxLength(100);
        order.Property(x => x.PostalCode).HasMaxLength(32);
        order.Property(x => x.CountryCode).HasMaxLength(2);

        var fulfillment = modelBuilder.Entity<FulfillmentEntity>();
        fulfillment.ToTable("fulfillments");
        fulfillment.HasKey(x => x.Id);
        fulfillment.HasIndex(x => new { x.Provider, x.ProviderOrderId }).IsUnique();
        fulfillment.Property(x => x.Provider).HasConversion<string>().HasMaxLength(32);
        fulfillment.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
        fulfillment.Property(x => x.ProviderOrderId).HasMaxLength(200);
        fulfillment.Property(x => x.TrackingNumber).HasMaxLength(200);
        fulfillment.Property(x => x.LastError).HasMaxLength(4000);
        fulfillment.HasOne(x => x.Order).WithMany(x => x.Fulfillments).HasForeignKey(x => x.OrderId).OnDelete(DeleteBehavior.Cascade);

        var line = modelBuilder.Entity<OrderLineEntity>();
        line.ToTable("order_lines");
        line.HasKey(x => x.Id);
        line.Property(x => x.Sku).HasMaxLength(100);
        line.Property(x => x.RetailPrice).HasPrecision(18, 2);
        line.Property(x => x.ProviderCost).HasPrecision(18, 2);
        line.Property(x => x.AllocatedShippingCost).HasPrecision(18, 2);
        line.Property(x => x.EstimatedGrossMargin).HasPrecision(18, 2);
        line.Property(x => x.Currency).HasMaxLength(3);
        line.Property(x => x.Provider).HasConversion<string>().HasMaxLength(32);
        line.HasOne(x => x.Fulfillment).WithMany(x => x.Lines).HasForeignKey(x => x.FulfillmentId).OnDelete(DeleteBehavior.Cascade);
        line.HasOne<ProductVariantEntity>().WithMany().HasForeignKey(x => x.ProductVariantId).OnDelete(DeleteBehavior.Restrict);

        var webhook = modelBuilder.Entity<WebhookReceiptEntity>();
        webhook.ToTable("webhook_inbox");
        webhook.HasKey(x => x.Id);
        webhook.HasIndex(x => new { x.Provider, x.ExternalEventId }).IsUnique();
        webhook.Property(x => x.Provider).HasMaxLength(50);
        webhook.Property(x => x.ExternalEventId).HasMaxLength(300);
        webhook.Property(x => x.EventType).HasMaxLength(200);

        var outbox = modelBuilder.Entity<OutboxMessageEntity>();
        outbox.ToTable("outbox_messages");
        outbox.HasKey(x => x.Id);
        outbox.HasIndex(x => new { x.ProcessedAt, x.OccurredAt });
        outbox.Property(x => x.Type).HasMaxLength(200);
        outbox.Property(x => x.Payload).HasColumnType("jsonb");
        outbox.Property(x => x.LastError).HasMaxLength(4000);

        var failure = modelBuilder.Entity<FailureHistoryEntity>();
        failure.ToTable("failure_history");
        failure.HasKey(x => x.Id);
        failure.HasIndex(x => new { x.AggregateType, x.AggregateId, x.OccurredAt });
        failure.Property(x => x.AggregateType).HasMaxLength(100);
        failure.Property(x => x.Operation).HasMaxLength(200);
        failure.Property(x => x.Error).HasMaxLength(4000);

        SeedCatalog(modelBuilder);
    }

    private static void SeedCatalog(ModelBuilder modelBuilder)
    {
        var artworkId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        var originalProductId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var printProductId = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var shirtProductId = Guid.Parse("33333333-3333-3333-3333-333333333333");

        modelBuilder.Entity<ArtworkEntity>().HasData(new ArtworkEntity
        {
            Id = artworkId, Title = "Sample Lake Study", Artist = "Portfolio Artist", OriginalAvailable = true,
            DisplayAssetId = "display/sample-lake-study.webp"
        });
        modelBuilder.Entity<ProductEntity>().HasData(
            new ProductEntity { Id = originalProductId, Name = "Original artwork", Description = "One-of-one artwork fulfilled by the studio." },
            new ProductEntity { Id = printProductId, Name = "Fine-art print", Description = "Archival reproduction fulfilled by Prodigi." },
            new ProductEntity { Id = shirtProductId, Name = "Art T-shirt", Description = "Apparel fulfilled by Printful." });
        modelBuilder.Entity<ProductVariantEntity>().HasData(
            new ProductVariantEntity { Id = Guid.Parse("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), ProductId = originalProductId, Sku = "ORIGINAL-SAMPLE-LAKE", Name = "Original", RetailPrice = 1200m, Currency = "USD", Provider = FulfillmentProviderCode.Internal, ProviderProductId = "internal", OriginalArtworkId = artworkId },
            new ProductVariantEntity { Id = Guid.Parse("22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), ProductId = printProductId, Sku = "PRINT-SAMPLE-LAKE-8X10", Name = "8 x 10", RetailPrice = 38m, Currency = "USD", Provider = FulfillmentProviderCode.Prodigi, ProviderProductId = "CONFIGURE_PRODIGI_MAPPING" },
            new ProductVariantEntity { Id = Guid.Parse("33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), ProductId = shirtProductId, Sku = "SHIRT-SAMPLE-LAKE-M", Name = "Medium", RetailPrice = 32m, Currency = "USD", Provider = FulfillmentProviderCode.Printful, ProviderProductId = "CONFIGURE_PRINTFUL_MAPPING" });
        modelBuilder.Entity<OriginalInventoryEntity>().HasData(new OriginalInventoryEntity { ArtworkId = artworkId, Status = ArtworkAvailability.Available });
    }
}

public sealed class ArtworkEntity
{
    public Guid Id { get; set; }
    public required string Title { get; set; }
    public required string Artist { get; set; }
    public bool OriginalAvailable { get; set; }
    public required string DisplayAssetId { get; set; }
}

public sealed class ProductEntity
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }
}

public sealed class ProductVariantEntity
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public required string Sku { get; set; }
    public required string Name { get; set; }
    public decimal RetailPrice { get; set; }
    public required string Currency { get; set; }
    public FulfillmentProviderCode Provider { get; set; }
    public required string ProviderProductId { get; set; }
    public Guid? OriginalArtworkId { get; set; }
}

public sealed class OriginalInventoryEntity
{
    public Guid ArtworkId { get; set; }
    public ArtworkAvailability Status { get; set; }
    public Guid? ReservationId { get; set; }
    public DateTimeOffset? ReservedUntil { get; set; }
    public uint Version { get; private set; }
}

public sealed class OrderEntity
{
    public Guid Id { get; set; }
    public Guid CustomerId { get; set; }
    public OrderStatus Status { get; set; }
    public decimal Total { get; set; }
    public required string Currency { get; set; }
    public required string ShippingName { get; set; }
    public required string AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public required string City { get; set; }
    public required string Region { get; set; }
    public required string PostalCode { get; set; }
    public required string CountryCode { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public List<FulfillmentEntity> Fulfillments { get; set; } = [];
}

public sealed class FulfillmentEntity
{
    public Guid Id { get; set; }
    public Guid OrderId { get; set; }
    public OrderEntity Order { get; set; } = null!;
    public FulfillmentProviderCode Provider { get; set; }
    public FulfillmentStatus Status { get; set; }
    public string? ProviderOrderId { get; set; }
    public string? TrackingNumber { get; set; }
    public string? LastError { get; set; }
    public List<OrderLineEntity> Lines { get; set; } = [];
}

public sealed class OrderLineEntity
{
    public Guid Id { get; set; }
    public Guid FulfillmentId { get; set; }
    public FulfillmentEntity Fulfillment { get; set; } = null!;
    public Guid ProductVariantId { get; set; }
    public required string Sku { get; set; }
    public int Quantity { get; set; }
    public decimal RetailPrice { get; set; }
    public decimal ProviderCost { get; set; }
    public decimal AllocatedShippingCost { get; set; }
    public decimal EstimatedGrossMargin { get; set; }
    public required string Currency { get; set; }
    public FulfillmentProviderCode Provider { get; set; }
}

public sealed class WebhookReceiptEntity
{
    public Guid Id { get; set; }
    public required string Provider { get; set; }
    public required string ExternalEventId { get; set; }
    public required string EventType { get; set; }
    public DateTimeOffset ReceivedAt { get; set; }
    public DateTimeOffset? ProcessedAt { get; set; }
}

public sealed class OutboxMessageEntity
{
    public Guid Id { get; set; }
    public required string Type { get; set; }
    public required string Payload { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
    public DateTimeOffset? ProcessedAt { get; set; }
    public int AttemptCount { get; set; }
    public string? LastError { get; set; }
}

public sealed class FailureHistoryEntity
{
    public Guid Id { get; set; }
    public required string AggregateType { get; set; }
    public Guid AggregateId { get; set; }
    public required string Operation { get; set; }
    public required string Error { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}
