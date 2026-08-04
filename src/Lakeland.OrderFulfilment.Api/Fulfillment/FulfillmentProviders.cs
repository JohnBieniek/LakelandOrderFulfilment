using Lakeland.OrderFulfilment.Api.Domain;

namespace Lakeland.OrderFulfilment.Api.Fulfillment;

public sealed record FulfillmentQuoteRequest(IReadOnlyList<OrderLine> Lines, ShippingAddress Destination);
public sealed record FulfillmentQuote(decimal ManufacturingCost, decimal ShippingCost, string Currency);
public sealed record FulfillmentRequest(Guid FulfillmentId, IReadOnlyList<OrderLine> Lines, ShippingAddress Destination, Uri? PrintAssetUrl);
public sealed record FulfillmentSubmission(string ProviderOrderId, FulfillmentStatus Status);
public sealed record CancelFulfillmentResult(bool Canceled, string? Reason = null);

public interface IFulfillmentProvider
{
    FulfillmentProviderCode ProviderCode { get; }
    Task<FulfillmentQuote> GetQuoteAsync(FulfillmentQuoteRequest request, CancellationToken cancellationToken);
    Task<FulfillmentSubmission> SubmitAsync(FulfillmentRequest request, CancellationToken cancellationToken);
    Task<FulfillmentStatus> GetStatusAsync(string providerOrderId, CancellationToken cancellationToken);
    Task<CancelFulfillmentResult> CancelAsync(string providerOrderId, CancellationToken cancellationToken);
}

public sealed class InternalFulfillmentProvider : IFulfillmentProvider
{
    public FulfillmentProviderCode ProviderCode => FulfillmentProviderCode.Internal;
    public Task<FulfillmentQuote> GetQuoteAsync(FulfillmentQuoteRequest request, CancellationToken token) => Task.FromResult(new FulfillmentQuote(0, 0, "USD"));
    public Task<FulfillmentSubmission> SubmitAsync(FulfillmentRequest request, CancellationToken token) => Task.FromResult(new FulfillmentSubmission($"internal-{request.FulfillmentId:N}", FulfillmentStatus.Accepted));
    public Task<FulfillmentStatus> GetStatusAsync(string id, CancellationToken token) => Task.FromResult(FulfillmentStatus.Accepted);
    public Task<CancelFulfillmentResult> CancelAsync(string id, CancellationToken token) => Task.FromResult(new CancelFulfillmentResult(true));
}

public abstract class ConfiguredHttpFulfillmentProvider(HttpClient httpClient, IConfiguration configuration) : IFulfillmentProvider
{
    protected HttpClient HttpClient { get; } = httpClient;
    protected IConfiguration Configuration { get; } = configuration;
    public abstract FulfillmentProviderCode ProviderCode { get; }
    protected abstract string TokenConfigurationKey { get; }
    protected string RequiredToken() => Configuration[TokenConfigurationKey] ?? throw new InvalidOperationException($"{TokenConfigurationKey} must be supplied by environment variables, user-secrets, or a production secret vault.");
    public virtual Task<FulfillmentQuote> GetQuoteAsync(FulfillmentQuoteRequest request, CancellationToken token) { _ = RequiredToken(); throw new NotSupportedException("Provider request mapping is intentionally disabled until sandbox credentials and approved product mappings are configured."); }
    public virtual Task<FulfillmentSubmission> SubmitAsync(FulfillmentRequest request, CancellationToken token) { _ = RequiredToken(); throw new NotSupportedException("Live submission is intentionally disabled until provider onboarding is complete."); }
    public virtual Task<FulfillmentStatus> GetStatusAsync(string id, CancellationToken token) { _ = RequiredToken(); throw new NotSupportedException("Provider status mapping is pending sandbox onboarding."); }
    public virtual Task<CancelFulfillmentResult> CancelAsync(string id, CancellationToken token) { _ = RequiredToken(); throw new NotSupportedException("Provider cancellation mapping is pending sandbox onboarding."); }
}

public sealed class ProdigiFulfillmentProvider(HttpClient client, IConfiguration configuration) : ConfiguredHttpFulfillmentProvider(client, configuration)
{
    public override FulfillmentProviderCode ProviderCode => FulfillmentProviderCode.Prodigi;
    protected override string TokenConfigurationKey => "Providers:Prodigi:ApiKey";
}

public sealed class PrintfulFulfillmentProvider(HttpClient client, IConfiguration configuration) : ConfiguredHttpFulfillmentProvider(client, configuration)
{
    public override FulfillmentProviderCode ProviderCode => FulfillmentProviderCode.Printful;
    protected override string TokenConfigurationKey => "Providers:Printful:ApiToken";
}
