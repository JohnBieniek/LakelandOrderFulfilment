# Security

This public repository contains no credentials and must remain safe to clone publicly.

- Card data must go directly to Stripe. The API stores provider IDs and payment state, never PAN or CVV.
- Prices must be loaded server-side from the catalog. Browser-submitted totals are never authoritative.
- Fulfillment begins only after a verified Stripe webhook, never from a success-page redirect.
- Provider credentials belong in .NET user-secrets locally and a managed secret vault in production.
- Print masters belong in private object storage and are shared only through short-lived signed URLs.
- Webhooks require provider-specific signature verification before processing and uniqueness by provider plus external event ID.
- Administrative actions require explicit authorization policies; customer order access requires ownership checks.
- Never commit customer data, real provider payloads, contract pricing, fraud rules, certificates, or production configuration.

If any credential is committed, revoke and rotate it immediately. Deleting a current file does not remove a secret from Git history.
