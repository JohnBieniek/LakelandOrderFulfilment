using Lakeland.OrderFulfilment.Api.Domain;
using Lakeland.OrderFulfilment.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Lakeland.OrderFulfilment.Api.Controllers;

[ApiController, Route("api/catalog")]
public sealed class CatalogController(CommerceStore store) : ControllerBase
{
    [HttpGet("artworks")] public ActionResult<IReadOnlyList<Artwork>> GetArtworks() => Ok(store.Artworks);
    [HttpGet("products")] public IActionResult GetProducts() => Ok(store.Products.Select(product => new { Product = product, Variants = store.Variants.Where(x => x.ProductId == product.Id) }));
}

[ApiController, Route("api/orders")]
public sealed class OrdersController(OrderService service, CommerceStore store) : ControllerBase
{
    [HttpPost]
    [ProducesResponseType<CustomerOrder>(StatusCodes.Status201Created)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public ActionResult<CustomerOrder> Create(CreateOrderRequest request)
    {
        try
        {
            var order = service.Create(request);
            return CreatedAtAction(nameof(Get), new { orderId = order.Id }, order);
        }
        catch (KeyNotFoundException exception) { return BadRequest(Problem(title: "Invalid product", detail: exception.Message)); }
        catch (ArgumentException exception) { return BadRequest(Problem(title: "Invalid order", detail: exception.Message)); }
        catch (InvalidOperationException exception) { return Conflict(Problem(title: "Inventory conflict", detail: exception.Message)); }
    }

    [HttpGet("{orderId:guid}")]
    [ProducesResponseType<CustomerOrder>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult<CustomerOrder> Get(Guid orderId) => store.FindOrder(orderId) is { } order ? Ok(order) : NotFound();
}

public sealed record WebhookEnvelope(string ExternalEventId, string EventType);

[ApiController, Route("api/webhooks")]
public sealed class WebhooksController(WebhookInbox inbox, TimeProvider timeProvider, IWebHostEnvironment environment, IConfiguration configuration) : ControllerBase
{
    [HttpPost("{provider}")]
    [ApiExplorerSettings(IgnoreApi = true)]
    public IActionResult Receive(string provider, WebhookEnvelope envelope)
    {
        if (environment.IsProduction() || !configuration.GetValue<bool>("WebhookSecurity:EnableUnsignedDevelopmentWebhooks")) return NotFound();
        if (!new[] { "stripe", "prodigi", "printful", "easypost" }.Contains(provider, StringComparer.OrdinalIgnoreCase)) return NotFound();
        if (string.IsNullOrWhiteSpace(envelope.ExternalEventId)) return BadRequest();
        return inbox.TryAccept(provider, envelope.ExternalEventId, envelope.EventType, timeProvider.GetUtcNow()) ? Accepted() : Ok(new { duplicate = true });
    }
}
