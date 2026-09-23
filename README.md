# Lakeland Order Fulfilment

Lakeland Fine Arts storefront and .NET commerce backend. The `develop` branch contains the beta home, gallery, products, contact, and cart pages. See [beta setup and deployment](docs/beta.md) for the preview, Stripe and PayPal test setup, and current launch requirements.

**Public beta:** https://lakeland-fine-arts-beta.johnbieniekgt.workers.dev (Cloudflare Workers, sample catalog, checkout disabled).

## Fulfillment routes

- Original artwork: internal studio fulfillment with exclusive timed reservation.
- Clay sculptures: made to order by the studio.
- Prints, framed prints, canvas, apparel, stickers, and merchandise: Printful (specific products and quality require approval).
- Original-art shipping labels: EasyPost (integration boundary planned).
- Payments: Cloudflare-native Stripe test Checkout and PayPal sandbox checkout with a separate D1 order ledger. [Configure payment accounts](docs/payments-cloudflare.md) to enable them.

There is intentionally no Gelato adapter or fallback.

## Run locally

```powershell
dotnet restore
dotnet test
dotnet run --project src/Lakeland.OrderFulfilment.Api
```

For the beta without database configuration:

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Beta'
dotnet run --project src/Lakeland.OrderFulfilment.Api --no-launch-profile --urls http://localhost:5188
```

In Development, open `/scalar/v1` for the interactive API and `/openapi/v1.json` for OpenAPI. Production does not expose interactive documentation.

## Current scope

The beta includes artist filtering/sorting, gallery-only fan art, a browser cart, dispatch estimates, and test-only Stripe and PayPal payment orchestration in the Cloudflare Worker. Illustrations and catalog values are explicitly labeled samples. The public Cloudflare Worker keeps checkout disabled until test credentials are configured; its D1 database stores sandbox orders only. Live payments and provider submission still require a production payment path, approved catalog mappings, shipping/tax rules, and operational workflows. The beta no longer depends on Azure.

See [Printful onboarding](docs/printful-onboarding.md) for the account setup and migration checklist.

See [TODO.txt](TODO.txt) for setup steps and [SECURITY.md](SECURITY.md) for security boundaries.
