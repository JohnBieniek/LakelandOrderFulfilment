# Stripe and PayPal on the Cloudflare beta

The Worker implements Stripe hosted Checkout and PayPal hosted sandbox approval/capture. Orders and original reservations use the separate `lakeland-payments-beta` D1 database. Prices come from the server's sample catalog. Card details never pass through our app. The code accepts **test payments only**; there is no live-payment switch.

Checkout stays disabled until the credentials below are stored in Cloudflare and `PAYMENTS_ENABLED` is `test`. .NET user-secrets are local to the .NET application; Cloudflare cannot read them. Never put payment keys in source, frontend JavaScript, chat, command arguments, or `wrangler.jsonc`.

## Account setup

### Stripe

1. Open the business's [Stripe Dashboard](https://dashboard.stripe.com/) and select its sandbox/test environment.
2. Obtain the test secret key (`sk_test_...`). This hosted integration does not require a publishable key.
3. Add an HTTPS webhook destination for these two events: `checkout.session.completed` and `checkout.session.expired`.
4. Use this exact endpoint:

   `https://lakeland-fine-arts-beta.johnbieniekgt.workers.dev/api/shop/stripe/webhook`

5. Obtain that destination's signing secret (`whsec_...`). A Stripe CLI forwarding secret is different from the deployed destination's secret.

### PayPal

1. Open the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) under the business account.
2. Create/select a **sandbox** REST app associated with the intended sandbox merchant. Obtain its client ID and secret.
3. In that same sandbox app, add a webhook subscribed to `PAYMENT.CAPTURE.COMPLETED`:

   `https://lakeland-fine-arts-beta.johnbieniekgt.workers.dev/api/shop/paypal/webhook`

4. Copy the webhook's ID. This is an ID, not a signing secret. The Worker uses PayPal's signature-verification API and its configured webhook ID.
5. Have a separate sandbox personal/buyer account available for checkout testing; do not use a real PayPal buyer login.

## Store credentials securely

From the repository in PowerShell, run the commands individually. Wrangler prompts for each value without placing it in shell history. Each provider can be configured independently.

```powershell
npx.cmd wrangler secret put STRIPE_SECRET_KEY
npx.cmd wrangler secret put STRIPE_WEBHOOK_SECRET
npx.cmd wrangler secret put PAYPAL_CLIENT_ID
npx.cmd wrangler secret put PAYPAL_CLIENT_SECRET
npx.cmd wrangler secret put PAYPAL_WEBHOOK_ID
```

After completing at least one provider's setup, run this and enter `test` at its prompt:

```powershell
npx.cmd wrangler secret put PAYMENTS_ENABLED
```

These commands update the deployed Worker. Refresh the cart to see available providers. To disable both providers, delete `PAYMENTS_ENABLED` with `npx.cmd wrangler secret delete PAYMENTS_ENABLED`.

For local integration testing only, the same names can be stored in the git-ignored `.dev.vars`. Never commit that file. The existing .NET payment configuration is separate and does not enable the Cloudflare Worker.

## Validation after connecting the accounts

- Use a sample mug first. Complete a Stripe test checkout and a PayPal sandbox checkout separately. Confirm their provider dashboards show test payments and the site confirms payment.
- Confirm declined/canceled checkouts preserve the cart. PayPal approval or visiting the success URL must not by itself mark an order paid.
- Check each provider's webhook delivery log. Stripe requires a valid raw-body HMAC; PayPal requires successful remote signature verification plus authenticated order retrieval.
- Inspect D1: `payment_orders` should be `Paid`, with exactly one `BetaPaymentRecorded` row in `payment_test_outbox` per paid order. No Printful order, label purchase, studio production, or email is triggered by these test records.
- Retry the same request and redeliver a webhook; no second payment or outbox row should be created. A different browser cannot read or capture the order because ownership is bound to an HttpOnly cookie.

Automated checks use mocked providers and real in-memory SQLite transactions; they do not validate account permissions or replace these end-to-end account tests:

```powershell
npm.cmd run test:payments
npm.cmd run check:cloudflare
npx.cmd wrangler d1 migrations apply lakeland-payments-beta --local
$env:TEST_HOST = 'cloudflare'
npm.cmd run test:e2e
```

Before deploying a fresh database, apply the additive schema with `npx.cmd wrangler d1 migrations apply lakeland-payments-beta --remote`. CI applies migrations before deployment too.

## Beta limits and launch work

- The shop still contains unapproved sample merchandise/prices. Shipping and taxes are not charged. Stripe collects a US shipping address; PayPal uses its buyer address. The beta ledger stores no address or card data and is not a production fulfillment order.
- An original is reserved atomically when checkout begins. Confirmed Stripe expiration releases it. Returning to the cart, local timeouts, or ambiguous provider failures do not release it, because a payment may still complete.
- PayPal abandoned orders and provider-creation failures require manual reconciliation before releasing originals. Never delete a reservation based only on age. This beta has no scheduled reconciliation service or inventory administration UI.
- Signed webhook retries and authenticated status checks recover payment confirmation. A late payment after cancellation goes to `Review`; it cannot trigger fulfillment. Refunds/disputes and post-payment operations are not implemented in this beta.
- Before real payments: approve actual catalog/variant mappings, implement address/fulfillment records, shipping/tax calculations, refunds/disputes, reconciliation, inventory administration and fulfillment queues, and complete provider live-account verification. Then add and review a separate production payment path; do not replace these test keys with live keys.

References: [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [Stripe signature verification](https://docs.stripe.com/webhooks/signature), [PayPal Orders v2](https://developer.paypal.com/api/orders/v2), [PayPal webhook verification](https://developer.paypal.com/api/rest/webhooks/rest/).
