# Printful onboarding and cutover

Printful is the sole active print-on-demand provider. Originals remain studio-fulfilled.
The public storefront fulfillment adapter remains disabled. A private local tool can now inspect published products, quote one mug, and create an unconfirmed draft using the existing .NET user-secret. It does not confirm orders or connect beta test payments to real production.

## Order the first mug

Connection checked on September 23, 2026: the existing token reaches store **18691434**, which Printful currently names **Personal orders**. It has order/product read and write scopes. The store contains **zero published products**. Product-template access returns HTTP 403 with this token; the mug design therefore cannot yet be retrieved. No order was created by this check.

1. In Printful, open **My products → Product templates**, select the mug, and **Publish / Add to store** for the intended API store. Check the store ID, since the name differs from the expected Lakeland Fine Arts name. If that destination is unavailable, resolve the store selection before creating a new product; do not recreate the artwork from the watermarked gallery copy.
2. Run `npm.cmd run printful:inspect`. It reads the existing `Providers:Printful:ApiToken` user-secret (or `Providers__Printful__ApiToken` environment variable) without displaying it. It lists store products and their **sync variant IDs**, not private artwork URLs.
3. Select the desired mug design and size. Save the recipient locally in the ignored `artifacts/mug-recipient.json`, using `name`, `address1`, optional `address2`, `city`, `state_code`, `country_code`, `zip`, and optional `email` / `phone`. Use uppercase two-letter US state and country codes. Do not commit addresses.
4. Request the quantity-one estimate, replacing the example ID with the chosen sync variant ID:

   ```powershell
   node scripts/printful-mug.mjs quote 123456789 artifacts/mug-recipient.json
   ```

5. After reviewing the quote, prepare a draft with a unique stable reference. **Reuse the same reference on retries**:

   ```powershell
   node scripts/printful-mug.mjs draft 123456789 artifacts/mug-recipient.json lakeland-mug-first-sample-20260923
   ```

The tool submits `confirm=false` and recovers an existing order by external ID before attempting a new draft. It rejects mismatched existing orders and non-mug or unready print-file mappings. Review the exact design, address, shipping and final cost in Printful before paying there. This is a regular quantity-one order estimate; it does not promise eligibility for Printful's discounted sample-order program.

Run `npm.cmd run test:printful` for the mocked integration checks. Live quote/draft validation is still pending a published mug and recipient address. No Cloudflare deployment or payment-provider setup is needed to order this first mug through the private tool.

Sources: [Printful product templates and publishing](https://help.printful.com/hc/en-us/articles/360014010300-What-s-a-product-template-and-how-does-it-work), [Printful Orders API](https://developers.printful.com/docs/#tag/Orders-API).

## Account setup

1. Register or sign in at https://www.printful.com/ using the business account.
2. In the dashboard, choose **Stores > Connect via API** and name the store `Lakeland Fine Arts`.
3. In https://developers.printful.com/login create a private token with **A single store** access to that store. Begin with read access to orders and sync products; enable write scopes only as the corresponding workflows are implemented.
4. Run `./scripts/Test-PrintfulConnection.ps1` in PowerShell. It prompts for the token without displaying it, calls only `GET /stores`, and prints store identification. It also accepts the `Providers__Printful__ApiToken` environment variable. Confirm the returned store is correct. The script does not persist the token.
5. Store the token privately under `Providers:Printful:ApiToken` in the API project's .NET user-secrets; use Key Vault for deployment. Do not paste it into chat, source files, issues, or logs.

Source: [Printful store setup](https://help.printful.com/hc/en-us/articles/23581702148764-How-do-I-create-and-use-a-manual-order-API-store) and [API authentication and stores](https://developers.printful.com/docs/).

## Product decisions needed

Supply the initial product types, sizes, framing choices, destination countries, currency, and approved artwork. Choose Printful catalog variants and approve samples before publishing. The sample 8 x 10 print and medium shirt remain placeholders, not approved purchasable Printful mappings. Do not assume Printful materials or sizes match the former provider.

Use an explicit mapping convention when implementing submission: Printful catalog `variant_id` and store `sync_variant_id` are different identifiers. The current generic `ProviderProductId` field must be resolved to one documented convention before use. Each order line needs its own approved artwork/file placement; the existing single print-asset field is insufficient for arbitrary mixed-artwork orders.

## Database cutover

- Apply the new `SwitchPrintCatalogToPrintful` migration through the normal deployment workflow after reviewing its SQL. It changes only the sample print catalog seed; it does not move historical orders or custom variants.
- Existing Prodigi orders retain their provider identity and must be reconciled separately. The enum value remains for historical deserialization, but its adapter and webhook route are removed.
- New orders containing a remaining Prodigi variant are rejected until that variant is deliberately remapped. Review custom catalog records and outstanding orders before deployment.
- After reconciliation, revoke unused Prodigi credentials in that provider's dashboard and remove their entries from user-secrets/Key Vault. Removing application configuration does not close the external account or revoke its keys.

## Remaining integration work

Implement authenticated quotes, per-line mappings/files, draft submission, status/cancellation, verified webhooks, payment gating, and durable background processing. Start with mocked requests and unconfirmed drafts (`confirm=false`) on the documented orders API; confirmation must remain disabled during onboarding. See [Printful orders API](https://developers.printful.com/docs/#tag/Orders-API).

No production deployment, account registration, credential revocation, or live order is performed by this repository change.
