using Stripe;
using Stripe.Checkout;

namespace Lakeland.OrderFulfilment.Api.Storefront;

public sealed record CheckoutLine(string Name, long UnitAmount, int Quantity);
public sealed record StripeCheckout(string Id, string Url);
public interface IStripeGateway
{
    bool Ready { get; }
    Task<StripeCheckout> CreateAsync(Guid orderId, IReadOnlyList<CheckoutLine> lines, DateTimeOffset expires, CancellationToken token);
}

public sealed class StripeGateway(IConfiguration configuration) : IStripeGateway
{
    // Beta deliberately accepts test keys only, even when someone accidentally configures a live key.
    public bool Ready => configuration["Payments:StripeSecretKey"]?.StartsWith("sk_test_", StringComparison.Ordinal) == true
        && configuration["Payments:StripeWebhookSecret"]?.StartsWith("whsec_", StringComparison.Ordinal) == true
        && Uri.TryCreate(configuration["Storefront:PublicUrl"], UriKind.Absolute, out var uri)
        && (uri.Scheme == "https" || uri.IsLoopback);

    public async Task<StripeCheckout> CreateAsync(Guid orderId, IReadOnlyList<CheckoutLine> lines, DateTimeOffset expires, CancellationToken token)
    {
        if (!Ready) throw new InvalidOperationException("Test checkout is not configured yet.");
        var origin = configuration["Storefront:PublicUrl"]!.TrimEnd('/');
        var service = new SessionService(new StripeClient(configuration["Payments:StripeSecretKey"]));
        var session = await service.CreateAsync(new SessionCreateOptions
        {
            Mode = "payment",
            PaymentMethodTypes = ["card"],
            ClientReferenceId = orderId.ToString(),
            Metadata = new() { ["order_id"] = orderId.ToString(), ["environment"] = "beta" },
            SuccessUrl = origin + "/checkout/success?session_id={CHECKOUT_SESSION_ID}",
            CancelUrl = origin + "/cart?checkout=canceled",
            ExpiresAt = expires.UtcDateTime,
            ShippingAddressCollection = new() { AllowedCountries = ["US"] },
            CustomText = new() { Submit = new() { Message = "Beta test order only. No artwork will be produced or shipped. Shipping charges are not final." } },
            LineItems = lines.Select(line => new SessionLineItemOptions
            {
                Quantity = line.Quantity,
                PriceData = new() { Currency = "usd", UnitAmount = line.UnitAmount,
                    ProductData = new() { Name = line.Name + " (beta test)" } }
            }).ToList()
        }, new RequestOptions { IdempotencyKey = "beta-checkout-" + orderId }, token);
        return new StripeCheckout(session.Id, session.Url);
    }
}
