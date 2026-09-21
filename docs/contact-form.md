# Contact form delivery

The Cloudflare Worker handles `POST /api/contact`. Required fields are `name` (1–100 characters), `email` (up to 254 characters), and `message` (1–3,000 characters). Whitespace-only fields are rejected. There is no subject dropdown.

Mail is sent through the native `CONTACT_EMAIL` binding to **contact-form@lakelandfinearts.com**, from **website@lakelandfinearts.com**. The visitor's address is used only as Reply-To, never as the authenticated sender. The recipient is fixed both in code and in the binding; visitors cannot change recipients. No email API key is embedded in browser code or source.

The domain already has Email Routing enabled. Its existing catch-all route handles delivery of the contact-form address. Sending to a verified account destination uses Cloudflare's free routing-based sending; paid arbitrary-recipient sending is not enabled. The destination must be verified using Cloudflare's verification email before deployment and delivery can be confirmed. This does not create a separate mailbox or change the existing catch-all.

The handler bounds the request body at 16 KiB while reading it, validates fields server-side, escapes HTML, enforces same-origin JSON requests, and uses Cloudflare rate-limit bindings (three requests per minute per IP, plus twenty per minute for the shared key). These Cloudflare counters operate per location and are an abuse deterrent, not a strict global quota or full bot challenge.

Only a completed provider send returns success. Delivery errors return 503; the browser retains the visitor's text and does not automatically retry. Successful handoff is not proof of inbox placement. Messages are not saved in an application database, and message contents and visitor addresses are not logged by this handler. Email delivery and recipient mailbox retention still apply.

The local Wrangler email binding is simulated; `remote: true` is deliberately not enabled. Automated tests mock delivery and do not send email. The .NET-only local preview does not implement this Cloudflare endpoint: use `npm run build:cloudflare` then `npx wrangler dev` to test the complete contact form locally.

Checks: `npm run test:contact`, `npm run check:cloudflare`, and the Playwright contact-form tests. After verifying the destination, deploy with `npm run deploy:cloudflare` and send one clearly marked test through the live form. Confirm receipt in the routed inbox before treating inbox delivery as verified.

References: [Cloudflare Email Service](https://developers.cloudflare.com/email-service/), [send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/), [rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
