# Lakeland Order Fulfilment

Lakeland Fine Arts storefront and .NET commerce backend. The `develop` branch contains the beta home, gallery, products, contact, and cart pages. See [beta setup and deployment](docs/beta.md) for the preview, Stripe test setup, and current launch requirements.

## Fulfillment routes

- Original artwork: internal studio fulfillment with exclusive timed reservation.
- Clay sculptures: made to order by the studio.
- Prints, framed prints, canvas, apparel, stickers, and merchandise: Printful (specific products and quality require approval).
- Original-art shipping labels: EasyPost (integration boundary planned).
- Payments: Stripe-hosted test Checkout implemented for the beta; credentials and a durable beta database are required to enable it.

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

The beta includes artist filtering/sorting, gallery-only fan art, a browser cart, dispatch estimates, and test-only Stripe payment orchestration. Illustrations and catalog values are explicitly labeled samples. Preview mode disables checkout. Live provider submission remains disabled pending approved catalog mappings and operational workflows. Azure publishing is currently blocked by a disabled, read-only subscription.

See [Printful onboarding](docs/printful-onboarding.md) for the account setup and migration checklist.

See [TODO.txt](TODO.txt) for setup steps and [SECURITY.md](SECURITY.md) for security boundaries.
