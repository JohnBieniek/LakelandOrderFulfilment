using System.Security.Cryptography;
using System.Text.Json;
using Lakeland.OrderFulfilment.Api.Domain;
using Lakeland.OrderFulfilment.Api.Persistence;
using Lakeland.OrderFulfilment.Api.Services;
using Lakeland.OrderFulfilment.Api.Storefront;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Stripe;

namespace Lakeland.OrderFulfilment.Api.Controllers;

[ApiController, Route("api/shop")]
public sealed class StorefrontController(StorefrontCatalog catalog, CommerceDbContext db, IStripeGateway stripe,
    StorefrontCheckoutService checkout, IConfiguration configuration) : ControllerBase
{
    private const string OwnerCookie = "lakeland_beta_cart";

    [HttpGet("catalog")]
    public async Task<IActionResult> Catalog(CancellationToken token)
    {
        EnsureOwner();
        var availability = await db.OriginalInventory.AsNoTracking().ToDictionaryAsync(i => i.ArtworkId, i => i.Status, token);
        return Ok(new {
            beta = true, currency = "USD", checkoutReady = stripe.Ready && !configuration.GetValue<bool>("Storefront:PreviewOnly"),
            contactEmail = "contact@lakelandfinearts.com",
            products = catalog.Products.Select(p => new { p.Id, p.Name, p.Artist, p.Kind, p.Price, p.Image, p.Description, p.Details, p.IsSample,
                maxQuantity = p.IsOriginal ? 1 : 25,
                available = !p.IsOriginal || (availability.TryGetValue(p.Id, out var status) && status == ArtworkAvailability.Available),
                estimate = catalog.Estimate(p) }),
            gallery = catalog.Gallery
        });
    }

    [HttpPost("checkout"), EnableRateLimiting("checkout")]
    public async Task<IActionResult> Checkout(ShopCheckoutRequest request, CancellationToken token)
    {
        if (!configuration.GetValue<bool>("Storefront:Enabled") || configuration.GetValue<bool>("Storefront:PreviewOnly"))
            return StatusCode(503, new { error = "Checkout is not enabled in this preview. Your cart is saved on this device." });
        if (Request.Headers["X-Lakeland-Cart"] != "1" || !Request.Cookies.TryGetValue(OwnerCookie, out var owner) || owner.Length != 64)
            return BadRequest(new { error = "Refresh the page before starting checkout." });
        try { return Ok(await checkout.CreateAsync(request, StorefrontCheckoutService.Hash(owner), token)); }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
        catch (InventoryConflictException ex) { return Conflict(new { error = ex.Message }); }
        catch (InvalidOperationException) { return StatusCode(503, new { error = "Test checkout is not ready yet. Please try again later." }); }
        catch (StripeException) { return StatusCode(502, new { error = "Stripe could not open checkout. Your cart is saved; retry with the same cart." }); }
        catch (DbUpdateException) { return Conflict(new { error = "Your cart changed or an original was just reserved. Refresh and try again." }); }
    }

    [HttpGet("checkout/status")]
    public async Task<IActionResult> Status([FromQuery] string sessionId, CancellationToken token)
    {
        if (!Request.Cookies.TryGetValue(OwnerCookie, out var owner)) return NotFound();
        var hash = StorefrontCheckoutService.Hash(owner);
        var record = await db.StorefrontCheckouts.AsNoTracking().SingleOrDefaultAsync(c => c.SessionId == sessionId && c.OwnerHash == hash, token);
        if (record is null) return NotFound();
        var status = await db.Orders.Where(o => o.Id == record.Id).Select(o => o.Status).SingleAsync(token);
        return Ok(new { status = status.ToString(), testOrder = true });
    }

    [HttpPost("stripe/webhook"), RequestSizeLimit(262144)]
    public async Task<IActionResult> StripeWebhook(CancellationToken token)
    {
        var secret = configuration["Payments:StripeWebhookSecret"];
        if (string.IsNullOrWhiteSpace(secret) || configuration.GetValue<bool>("Storefront:PreviewOnly")) return NotFound();
        using var reader = new StreamReader(Request.Body);
        var raw = await reader.ReadToEndAsync(token);
        try
        {
            EventUtility.ConstructEvent(raw, Request.Headers["Stripe-Signature"].ToString(), secret, throwOnApiVersionMismatch: false);
            using var document = JsonDocument.Parse(raw);
            await checkout.ApplyStripeEventAsync(document.RootElement, token);
            return Ok();
        }
        catch (StripeException) { return BadRequest(); }
        catch (JsonException) { return BadRequest(); }
        catch (ArgumentException) { return BadRequest(); }
    }

    private void EnsureOwner()
    {
        if (!Request.Cookies.TryGetValue(OwnerCookie, out var existing) || existing.Length != 64)
            Response.Cookies.Append(OwnerCookie, Convert.ToHexString(RandomNumberGenerator.GetBytes(32)), new CookieOptions
                { HttpOnly = true, Secure = Request.IsHttps, SameSite = SameSiteMode.Lax, MaxAge = TimeSpan.FromDays(7), IsEssential = true });
        Response.Headers.CacheControl = "no-store";
    }
}
