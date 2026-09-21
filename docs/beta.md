# Develop storefront beta

The `develop` branch contains the responsive storefront. The public beta is hosted on **Cloudflare Workers** at https://lakeland-fine-arts-beta.johnbieniekgt.workers.dev. Pages are `/`, `/gallery`, `/products`, `/contact`, `/cart`, and `/checkout/success`.

## What works

- Artist filters and artist/title sorting in the gallery and shop; category and price filters in the shop.
- A separate gallery-only fan art section. Fan art has no product mapping and cannot pass server-side checkout validation.
- Sample originals, made-to-order clay sculptures, and a print-on-demand mug, with per-product estimated dispatch dates.
- A persistent browser cart, quantities, removals, and one-per-order original limits.
- Contact form opens an email draft to the studio; it does not claim to send messages.
- Stripe-hosted **test** Checkout integration with server-owned prices, guest-cookie order ownership, idempotent requests, original reservations, signed webhooks, replay protection, and transactional payment/outbox persistence.
- Cloudflare Workers hosting, with the same static assets and a catalog exported from the .NET source. Shipping estimates are calculated per request. The .NET payment backend is retained in the repository but does not run in the Cloudflare preview Worker.

## Run locally

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Beta'
dotnet run --project src/Lakeland.OrderFulfilment.Api --no-launch-profile --urls http://localhost:5188
```

`appsettings.Beta.json` enables preview mode: the catalog uses a disposable in-memory database, cart contents stay in the browser, and payment/order creation is disabled. No production database or Printful credential is used. **Do not turn off preview mode without a separate working PostgreSQL database and Stripe test configuration.**

All artwork images are repository-owned illustrative SVG placeholders. Names, artist labels, prices, sizes, and shipping estimates are examples, not approved merchandise. The only intended Printful launch category is the mug. The connected Printful store returned no published sync products during setup; publish the mug into the API store and supply its approved sync variant mapping before real fulfillment.

## Publishing to Cloudflare

```powershell
npm ci
npm run deploy:cloudflare
```

Wrangler uses your local Cloudflare login. `build:cloudflare` builds the .NET project and exports only its public sample catalog without loading secrets, starting the server, or connecting to a database. The Worker serves that catalog and the existing `wwwroot` assets; no Azure resources are involved. Checkout returns 503 and all other private/order/payment endpoints return 404 in the preview.

The deployed preview has no order database and cannot charge cards or submit Printful orders. Hosting or porting the payment backend and configuring durable storage are required before connecting payments. Adding a Stripe secret to this Worker alone does not enable checkout.

CI tests both .NET and Cloudflare hosting. Automatic Cloudflare deployment is prepared but requires a dedicated deployment token, rather than copying a personal OAuth session into GitHub:

1. In GitHub's `development` environment, set variable `CLOUDFLARE_ACCOUNT_ID` and secret `CLOUDFLARE_API_TOKEN` (a Cloudflare Workers deployment token scoped to the intended account).
2. Restrict that GitHub environment to branch `develop`.
3. Set repository variable `CLOUDFLARE_BETA_DEPLOY_ENABLED=true`. Pushes to `develop` then deploy only after CI passes. Until configured, use the authenticated local deployment command above.

To run browser tests against the Worker locally, build first, set `$env:TEST_HOST = 'cloudflare'`, and run `npm run test:e2e`. To test the live deployment, set `$env:BASE_URL = 'https://lakeland-fine-arts-beta.johnbieniekgt.workers.dev'` instead.

## Earlier Azure deployment option

Deployment was attempted on September 21, 2026. Azure returned `ReadOnlyDisabledSubscription`: the subscription must be re-enabled before publishing. The existing PostgreSQL server also reports `Disabled`. No beta cloud resource or database migration was applied.

After restoring the subscription, run the following from a clean, committed `develop` checkout using the existing hosting resource names from Azure:

```powershell
./scripts/Deploy-Beta.ps1 -ResourceGroup '<existing-resource-group>' -RegistryName '<existing-registry>' -ContainerEnvironmentName '<existing-container-environment>'
```

This optional script builds the committed image, deploys `ca-lakeland-beta`, and creates separate runtime/deployment identities. It is retained for reference, but CI now targets Cloudflare and does not automatically deploy to Azure. The Azure resources are not used by the public beta.

## Connect Stripe test payments

1. Provision a **separate beta PostgreSQL database**. Never point the beta at production data.
2. Configure the existing `Database:*` settings or `ConnectionStrings:Commerce`, and set `Database:ApplyMigrations=true` for deployment. The new migration adds durable checkout records; beta startup seeds sample catalog records into this database.
3. Configure `Payments:StripeSecretKey` with a Stripe **test** secret key, `Payments:StripeWebhookSecret` with the endpoint secret, and `Storefront:PublicUrl` with the beta HTTPS origin. Store these privately in user-secrets/Key Vault, not source or chat.
4. Register `/api/shop/stripe/webhook` for `checkout.session.completed` and `checkout.session.expired`. Locally, forward these events with Stripe CLI. The webhook verifies the raw body using Stripe's official SDK and rejects live events.
5. Set `Storefront:PreviewOnly=false` and leave `Storefront:Enabled=true`. The cart enables checkout only when a test key, webhook secret, public URL, and durable database mode are configured.
6. Run a test purchase and verify the paid order, one `BetaPaymentRecorded` outbox row, and original reservation changes. Never treat the success redirect as payment confirmation.

Stripe test orders do not trigger Printful production or studio fulfillment. Only US address collection is enabled initially. Shipping charges and taxes are not calculated in beta; the UI explicitly says so. Printful manufacturing and shipping API calls, EasyPost labels, actual product publishing, verified fulfillment webhooks, staff operations, and live payments remain launch work.

Reservations release on signed Checkout expiration events; replayed or late expiration events cannot reverse a paid order. If Stripe session creation has an ambiguous network failure, retry the same checkout request to recover using its idempotency key. Stuck sessions or missed expiry webhooks require reconciliation before live use; there is no production reconciliation worker yet.

## Validation

```powershell
dotnet test --configuration Release
npm ci
npm run test:e2e
```

Browser tests use installed Chrome on Windows and Playwright Chromium in CI. They cover page navigation, artist filters, fan art separation, the mixed cart, persistence, mobile overflow, and contact form semantics. Preview screenshots are saved in ignored `artifacts/` and uploaded by CI. No real Stripe charge or Printful order is part of these tests.

See [Stripe Checkout](https://docs.stripe.com/payments/checkout) and [Stripe webhook signatures](https://docs.stripe.com/webhooks/signature) for account setup.
