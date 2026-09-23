export type Provider = 'stripe' | 'paypal';
export interface PaymentSecrets {
  PAYMENTS_ENABLED?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
}
export interface PaymentLine { id: string; name: string; unitAmount: number; quantity: number; original: boolean; }
export interface PaymentOrder {
  id: string; owner_hash: string; provider: Provider; cart_hash: string; lines_json: string;
  amount_cents: number; currency: string; status: string; provider_id: string | null;
  approval_url: string | null; created_at: number; expires_at: number; updated_at: number;
}
export class PaymentError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}
export function readiness(env: PaymentSecrets) {
  const enabled = env.PAYMENTS_ENABLED === 'test';
  return {
    stripe: enabled && !!env.STRIPE_SECRET_KEY?.startsWith('sk_test_') && !!env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'),
    paypal: enabled && !!env.PAYPAL_CLIENT_ID && !!env.PAYPAL_CLIENT_SECRET && !!env.PAYPAL_WEBHOOK_ID
  };
}
export async function boundedText(message: Request | Response, limit: number): Promise<string> {
  const reader = message.body?.getReader();
  if (!reader) return '';
  let size = 0, text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new PaymentError('Request or response is too large.', 413); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
type JsonObject = Record<string, any>; // Provider JSON is validated at the trust boundary below.
async function api(url: string, init: RequestInit, fetcher: typeof fetch): Promise<JsonObject> {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(15000), redirect: 'error' });
  const text = await boundedText(response, 262144);
  if (!response.ok) throw new PaymentError('The payment provider could not complete this request. Please retry the same checkout.');
  try { return JSON.parse(text); } catch { throw new PaymentError('Invalid payment provider response.'); }
}
const paypalBase = 'https://api-m.sandbox.paypal.com';
async function paypalToken(env: PaymentSecrets, fetcher: typeof fetch): Promise<string> {
  const data = await api(paypalBase + '/v1/oauth2/token', {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  }, fetcher);
  if (typeof data.access_token !== 'string') throw new PaymentError('PayPal authentication failed.');
  return data.access_token;
}
async function paypalApi(path: string, env: PaymentSecrets, fetcher: typeof fetch, init: RequestInit = {}) {
  const token = await paypalToken(env, fetcher);
  return api(paypalBase + path, { ...init, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...init.headers } }, fetcher);
}
async function stripeApi(path: string, env: PaymentSecrets, fetcher: typeof fetch, init: RequestInit = {}) {
  if (!env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new PaymentError('Only Stripe test keys are accepted.', 503);
  return api('https://api.stripe.com/v1' + path, { ...init, headers: {
    Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded', ...init.headers
  } }, fetcher);
}
export function allowedRedirect(url: unknown, provider: Provider): url is string {
  if (typeof url !== 'string') return false;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.port && !parsed.username && !parsed.password
    && parsed.hostname === (provider === 'stripe' ? 'checkout.stripe.com' : 'www.sandbox.paypal.com'); }
  catch { return false; }
}
export async function createProviderCheckout(order: PaymentOrder, origin: string, env: PaymentSecrets, fetcher: typeof fetch = fetch) {
  const lines: PaymentLine[] = JSON.parse(order.lines_json);
  if (order.provider === 'stripe') {
    const body = new URLSearchParams({ mode: 'payment', 'payment_method_types[0]': 'card',
      client_reference_id: order.id, 'metadata[order_id]': order.id, 'metadata[environment]': 'lakeland-beta',
      success_url: `${origin}/checkout/success?provider=stripe&order_id=${order.id}`,
      cancel_url: `${origin}/cart?checkout=canceled`, expires_at: String(order.expires_at),
      'shipping_address_collection[allowed_countries][0]': 'US',
      'custom_text[submit][message]': 'Beta test only. No real charges, production or shipping.' });
    lines.forEach((line, i) => {
      body.set(`line_items[${i}][quantity]`, String(line.quantity));
      body.set(`line_items[${i}][price_data][currency]`, 'usd');
      body.set(`line_items[${i}][price_data][unit_amount]`, String(line.unitAmount));
      body.set(`line_items[${i}][price_data][product_data][name]`, line.name + ' (beta test)');
    });
    const data = await stripeApi('/checkout/sessions', env, fetcher, { method: 'POST', body, headers: { 'Idempotency-Key': 'lakeland-' + order.id } });
    if (data.livemode !== false || typeof data.id !== 'string' || !data.id.startsWith('cs_test_') || !allowedRedirect(data.url, 'stripe'))
      throw new PaymentError('Unexpected Stripe checkout response.');
    return { id: data.id, url: data.url };
  }
  const data = await paypalApi('/v2/checkout/orders', env, fetcher, { method: 'POST',
    headers: { 'PayPal-Request-Id': order.id, Prefer: 'return=representation' },
    body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: order.id, custom_id: order.id,
      description: 'Lakeland Fine Arts beta test — no production or shipping',
      amount: { currency_code: 'USD', value: (order.amount_cents / 100).toFixed(2),
        breakdown: { item_total: { currency_code: 'USD', value: (order.amount_cents / 100).toFixed(2) } } },
      items: lines.map(line => ({ name: line.name + ' (beta test)', quantity: String(line.quantity),
        unit_amount: { currency_code: 'USD', value: (line.unitAmount / 100).toFixed(2) } })) }],
      payment_source: { paypal: { experience_context: { user_action: 'PAY_NOW', shipping_preference: 'GET_FROM_FILE',
        return_url: `${origin}/checkout/success?provider=paypal&order_id=${order.id}`,
        cancel_url: `${origin}/cart?checkout=canceled` } } } }) });
  const link = data.links?.find((link: JsonObject) => link.rel === 'payer-action' || link.rel === 'approve');
  if (typeof data.id !== 'string' || !/^[A-Z0-9]+$/.test(data.id) || !allowedRedirect(link?.href, 'paypal'))
    throw new PaymentError('Unexpected PayPal checkout response.');
  return { id: data.id, url: link.href as string };
}
export function stripeState(data: JsonObject, order: PaymentOrder): 'Paid' | 'Canceled' | null {
  if (data.livemode !== false || data.id !== order.provider_id || data.client_reference_id !== order.id
      || data.metadata?.environment !== 'lakeland-beta' || data.metadata?.order_id !== order.id
      || data.amount_total !== order.amount_cents || data.currency !== 'usd') throw new PaymentError('Payment does not match this order.', 400);
  if (data.status === 'complete' && data.payment_status === 'paid') return 'Paid';
  return data.status === 'expired' && data.payment_status !== 'paid' ? 'Canceled' : null;
}
export function paypalState(data: JsonObject, order: PaymentOrder): 'Paid' | 'Canceled' | null {
  const unit = data.purchase_units?.[0];
  if (data.id !== order.provider_id || data.purchase_units?.length !== 1 || unit?.custom_id !== order.id
      || unit?.reference_id !== order.id || unit?.amount?.currency_code !== 'USD'
      || unit?.amount?.value !== (order.amount_cents / 100).toFixed(2)) throw new PaymentError('Payment does not match this order.', 400);
  if (data.status === 'COMPLETED') {
    const captures = unit.payments?.captures;
    if (!Array.isArray(captures) || captures.length !== 1 || captures[0].status !== 'COMPLETED'
        || captures[0].amount?.currency_code !== 'USD' || captures[0].amount?.value !== (order.amount_cents / 100).toFixed(2))
      throw new PaymentError('Capture is not a completed payment for this order.', 400);
    return 'Paid';
  }
  return data.status === 'VOIDED' ? 'Canceled' : null;
}
export async function retrieveState(order: PaymentOrder, env: PaymentSecrets, fetcher: typeof fetch = fetch) {
  if (!order.provider_id) return null;
  return order.provider === 'stripe'
    ? stripeState(await stripeApi('/checkout/sessions/' + encodeURIComponent(order.provider_id), env, fetcher), order)
    : paypalState(await paypalApi('/v2/checkout/orders/' + encodeURIComponent(order.provider_id), env, fetcher), order);
}
export async function capturePayPal(order: PaymentOrder, env: PaymentSecrets, fetcher: typeof fetch = fetch) {
  // This API is permanently pinned to sandbox. Browser token/PayerID never selects the order.
  await paypalApi('/v2/checkout/orders/' + encodeURIComponent(order.provider_id!) + '/capture', env, fetcher,
    { method: 'POST', headers: { 'PayPal-Request-Id': order.id.replace(/-/g, '') + '-cap', Prefer: 'return=representation' }, body: '{}' });
  // Read the full order: capture responses can omit purchase-unit amount fields.
  return retrieveState(order, env, fetcher);
}
export async function verifyStripe(raw: string, signature: string | null, secret: string, now = Date.now()) {
  if (!signature) return false;
  const parts = signature.split(',').map(s => s.split('='));
  const timestamp = parts.find(p => p[0] === 't')?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  for (const [kind, value] of parts) {
    if (kind !== 'v1' || !/^[a-f0-9]{64}$/i.test(value || '')) continue;
    const bytes = Uint8Array.from(value.match(/../g)!, hex => parseInt(hex, 16));
    if (await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(timestamp + '.' + raw))) return true;
  }
  return false;
}
export async function verifyPayPal(event: unknown, headers: Headers, env: PaymentSecrets, fetcher: typeof fetch = fetch) {
  const required = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
  if (required.some(h => !headers.get(h))) return false;
  // PayPal verifies the signature. Never fetch the user-supplied certificate URL ourselves.
  const result = await paypalApi('/v1/notifications/verify-webhook-signature', env, fetcher, { method: 'POST', body: JSON.stringify({
    auth_algo: headers.get(required[0]), cert_url: headers.get(required[1]), transmission_id: headers.get(required[2]),
    transmission_sig: headers.get(required[3]), transmission_time: headers.get(required[4]), webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: event
  }) });
  return result.verification_status === 'SUCCESS';
}
