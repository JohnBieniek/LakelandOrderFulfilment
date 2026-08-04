# Lakeland Order Fulfilment

Public-safe .NET backend foundation for an art storefront. The storefront owns its catalog and splits a single customer order into provider-specific fulfillment groups.

## Fulfillment routes

- Original artwork: internal studio fulfillment with exclusive timed reservation.
- Fine-art prints, framed prints, and canvas: Prodigi.
- Apparel, stickers, and merchandise: Printful.
- Original-art shipping labels: EasyPost (integration boundary planned).
- Payments: Stripe-hosted Checkout or Payment Element (integration boundary planned).

There is intentionally no Gelato adapter or fallback.

## Run locally

```powershell
dotnet restore
dotnet test
dotnet run --project src/Lakeland.OrderFulfilment.Api
```

In Development, open `/scalar/v1` for the interactive API and `/openapi/v1.json` for OpenAPI. Production does not expose interactive documentation.

## Current scope

This first commit provides catalog-owned mappings, mixed-order splitting, concurrency-safe original reservation, provider interfaces, webhook deduplication, safe configuration placeholders, a health endpoint, API documentation, and tests. Provider submission is deliberately disabled until sandbox accounts, approved mappings, signature verification, durable storage, and background processing are configured.

See [TODO.txt](TODO.txt) for setup steps and [SECURITY.md](SECURITY.md) for security boundaries.
