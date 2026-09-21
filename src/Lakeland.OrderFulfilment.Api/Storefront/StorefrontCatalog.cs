using Lakeland.OrderFulfilment.Api.Domain;
using Lakeland.OrderFulfilment.Api.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Lakeland.OrderFulfilment.Api.Storefront;

public sealed record ShopProduct(Guid Id, string Name, string Artist, string Kind, decimal Price, string Image,
    string Description, string Details, int MinBusinessDays, int MaxBusinessDays, bool IsSample = true)
{
    public bool IsOriginal => Kind == "original";
    public FulfillmentProviderCode Provider => Kind == "printful" ? FulfillmentProviderCode.Printful : FulfillmentProviderCode.Internal;
}
public sealed record GalleryWork(string Id, string Title, string Artist, string Medium, string Image, bool FanArt, Guid? ProductId);
public sealed record ShipEstimate(DateOnly Earliest, DateOnly Latest, string Description);

public sealed class StorefrontCatalog(TimeProvider clock)
{
    // Beta display examples only. Replace with approved work, pricing, and per-product lead times before launch.
    public IReadOnlyList<ShopProduct> Products { get; } = [
        new(Guid.Parse("b1111111-1111-4111-8111-111111111111"), "Where the water settles", "Studio painter", "original", 420,
            "/art/lake.svg", "A quiet study of water, light, and the spaces in between.", "Original painting · 18 × 24 in · Unframed", 3, 5),
        new(Guid.Parse("b2222222-2222-4222-8222-222222222222"), "The long way home", "Studio painter", "original", 360,
            "/art/hills.svg", "Soft hills and a familiar path, held in the warm colors of the afternoon.", "Original painting · 16 × 20 in · Unframed", 3, 5),
        new(Guid.Parse("b3333333-3333-4333-8333-333333333333"), "A little wild", "Studio painter", "original", 280,
            "/art/botanical.svg", "An expressive botanical study that brings a little of the outdoors inside.", "Original painting · 12 × 16 in · Unframed", 3, 5),
        new(Guid.Parse("b4444444-4444-4444-8444-444444444444"), "The quiet companion", "Studio sculptor", "clay", 85,
            "/art/sculpture.svg", "A small, hand-built clay companion. Made especially for you, with its own gentle character.", "Made to order · Hand-built clay · Approx. 5 in tall", 15, 25),
        new(Guid.Parse("b5555555-5555-4555-8555-555555555555"), "Little woodland spirit", "Studio sculptor", "clay", 65,
            "/art/woodland.svg", "A playful little sculpture for a shelf, a desk, or a favorite corner.", "Made to order · Hand-built clay · Approx. 4 in tall", 15, 25),
        new(Guid.Parse("b6666666-6666-4666-8666-666666666666"), "The everyday art mug", "Studio painter", "printful", 24,
            "/art/mug.svg", "A little art for your everyday ritual. Printed on demand and sent directly by Printful.", "Print-on-demand mug · Actual design and size to be confirmed", 4, 8)
    ];

    public IReadOnlyList<GalleryWork> Gallery => Products.Where(p => p.Kind != "printful")
        .Select(p => new GalleryWork(p.Id.ToString(), p.Name, p.Artist, p.Details.Split('·')[0].Trim(), p.Image, false, p.Id))
        .Concat([
            new GalleryWork("fan-moon", "Somewhere among the stars", "Studio painter", "Fan art study · Display only", "/art/moon.svg", true, null),
            new GalleryWork("fan-forest", "A storybook kind of place", "Studio sculptor", "Fan art study · Display only", "/art/forest.svg", true, null)
        ]).ToArray();

    public ShipEstimate Estimate(ShopProduct product) => new(AddBusinessDays(DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime), product.MinBusinessDays),
        AddBusinessDays(DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime), product.MaxBusinessDays),
        product.Kind switch { "clay" => "Handmade to order in our studio", "printful" => "Printed and shipped by Printful", _ => "Carefully packed and shipped by our studio" });

    public static DateOnly AddBusinessDays(DateOnly date, int days)
    {
        while (days > 0) { date = date.AddDays(1); if (date.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday)) days--; }
        return date;
    }

    public IReadOnlyList<(ShopProduct Product, int Quantity)> Validate(IReadOnlyList<CreateOrderItemRequest>? items)
    {
        if (items is null || items.Count is < 1 or > 30) throw new ArgumentException("Choose between 1 and 30 cart items.");
        if (items.Any(i => i.Quantity is < 1 or > 25)) throw new ArgumentException("Quantity must be between 1 and 25.");
        return items.GroupBy(i => i.ProductVariantId).Select(group =>
        {
            var product = Products.SingleOrDefault(p => p.Id == group.Key) ?? throw new ArgumentException("An item is not available in the shop. Gallery-only art cannot be purchased.");
            var quantity = group.Sum(i => i.Quantity);
            if (quantity > (product.IsOriginal ? 1 : 25)) throw new ArgumentException(product.IsOriginal ? "An original painting is one of a kind. Quantity must be one." : "Maximum quantity is 25.");
            return (product, quantity);
        }).OrderBy(x => x.product.Id).ToArray();
    }

    public async Task SeedAsync(CommerceDbContext db, CancellationToken token)
    {
        foreach (var p in Products)
        {
            if (await db.ProductVariants.AnyAsync(v => v.Id == p.Id, token)) continue;
            db.Products.Add(new ProductEntity { Id = p.Id, Name = p.Name, Description = p.Description });
            if (p.IsOriginal)
            {
                db.Artworks.Add(new ArtworkEntity { Id = p.Id, Title = p.Name, Artist = p.Artist, DisplayAssetId = p.Image, OriginalAvailable = true });
                db.OriginalInventory.Add(new OriginalInventoryEntity { ArtworkId = p.Id, Status = ArtworkAvailability.Available });
            }
            db.ProductVariants.Add(new ProductVariantEntity { Id = p.Id, ProductId = p.Id, Sku = $"BETA-{p.Id:N}", Name = p.Name,
                Currency = "USD", RetailPrice = p.Price, Provider = p.Provider, ProviderProductId = p.Kind == "printful" ? "CONFIGURE_PRINTFUL_SYNC_VARIANT" : "internal",
                OriginalArtworkId = p.IsOriginal ? p.Id : null });
        }
        await db.SaveChangesAsync(token);
    }
}
