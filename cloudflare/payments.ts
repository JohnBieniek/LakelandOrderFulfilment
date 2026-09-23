import { PaymentError, readiness, boundedText, createProviderCheckout, retrieveState, capturePayPal, verifyStripe, verifyPayPal, stripeState } from './payment-providers.ts';
import type { PaymentSecrets, PaymentOrder, PaymentLine, Provider } from './payment-providers.ts';

export type PaymentEnvironment = Env & PaymentSecrets;
type Product = { id: string; name: string; price: number; isOriginal: boolean };
const cookieName = 'lakeland_payment_owner';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const now = () => Math.floor(Date.now() / 1000);
async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join('');
}
function owner(request: Request) {
  const value = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function setOwnerCookie(request: Request, response: Response) {
  if (!owner(request)) {
    const value = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
    response.headers.append('Set-Cookie', `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`);
  }
  return response;
}
export async function reservedProducts(env: PaymentEnvironment) {
  const result = await env.PAYMENTS_DB.prepare('SELECT product_id FROM payment_original_reservations').all<{product_id: string}>();
  return new Set(result.results.map(row => row.product_id));
}
async function body(request: Request) {
  try { return JSON.parse(await boundedText(request, 32768)); }
  catch (error) { if (error instanceof PaymentError) throw error; throw new PaymentError('Invalid request.', 400); }
}
async function ownedOrder(request: Request, env: PaymentEnvironment, id: unknown) {
  const token = owner(request);
  if (!token || typeof id !== 'string' || !uuid.test(id)) throw new PaymentError('Checkout not found on this device.', 404);
  const order = await env.PAYMENTS_DB.prepare('SELECT * FROM payment_orders WHERE id = ? AND owner_hash = ?').bind(id, await hash(token)).first<PaymentOrder>();
  if (!order) throw new PaymentError('Checkout not found on this device.', 404);
  return order;
}
export async function applyState(env: PaymentEnvironment, order: PaymentOrder, state: 'Paid' | 'Canceled' | null, event?: {id: string; type: string}) {
  const db = env.PAYMENTS_DB, time = now();
  const statements = [];
  if (event) statements.push(db.prepare('INSERT OR IGNORE INTO payment_events (provider,event_id,order_id,event_type,received_at) VALUES (?,?,?,?,?)').bind(order.provider, event.id, order.id, event.type, time));
  if (state) {
    // A late payment after cancellation needs manual review, never automatic fulfillment.
    if (state === 'Paid') statements.push(db.prepare("UPDATE payment_orders SET status='Review',updated_at=? WHERE id=? AND status='Canceled'").bind(time, order.id));
    statements.push(db.prepare("UPDATE payment_orders SET status=?,updated_at=? WHERE id=? AND status='PendingPayment'").bind(state, time, order.id));
    statements.push(db.prepare("INSERT OR IGNORE INTO payment_test_outbox (order_id,event_type,created_at) SELECT id,'BetaPaymentRecorded',? FROM payment_orders WHERE id=? AND status='Paid'").bind(time, order.id));
    statements.push(db.prepare("DELETE FROM payment_original_reservations WHERE order_id=? AND EXISTS (SELECT 1 FROM payment_orders WHERE id=? AND status='Canceled')").bind(order.id, order.id));
  }
  if (statements.length) await db.batch(statements);
}
async function checkout(request: Request, env: PaymentEnvironment, products: Product[], fetcher: typeof fetch) {
  const input = await body(request);
  const provider: Provider = input?.provider ?? 'stripe';
  if (!['stripe', 'paypal'].includes(provider)) throw new PaymentError('Choose Stripe or PayPal.', 400);
  if (!readiness(env)[provider]) throw new PaymentError('Test checkout is not configured yet. Your cart is saved.', 503);
  const token = owner(request);
  if (!token) throw new PaymentError('Refresh the page to begin a secure checkout.', 403);
  if (!uuid.test(input.requestId) || !Array.isArray(input.items) || !input.items.length || input.items.length > 30) throw new PaymentError('Invalid cart.', 400);
  const quantities = new Map<string, number>();
  for (const item of input.items) {
    if (!item || typeof item.productVariantId !== 'string' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 25) throw new PaymentError('Invalid quantity.', 400);
    quantities.set(item.productVariantId, (quantities.get(item.productVariantId) ?? 0) + item.quantity);
  }
  const lines: PaymentLine[] = [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([id, quantity]) => {
    const product = products.find(p => p.id === id);
    if (!product || quantity > (product.isOriginal ? 1 : 25)) throw new PaymentError('An item or quantity is unavailable.', 400);
    return { id, name: product.name, quantity, unitAmount: Math.round(product.price * 100), original: product.isOriginal };
  });
  const amount = lines.reduce((sum, line) => sum + line.unitAmount * line.quantity, 0);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 99999999) throw new PaymentError('Invalid total.', 400);
  const ownerHash = await hash(token), cartHash = await hash(JSON.stringify(lines)), time = now();
  const db = env.PAYMENTS_DB;
  let order = await db.prepare('SELECT * FROM payment_orders WHERE id=?').bind(input.requestId).first<PaymentOrder>();
  if (!order) {
    try {
      await db.batch([
        db.prepare('INSERT INTO payment_orders (id,owner_hash,provider,cart_hash,lines_json,amount_cents,created_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(input.requestId, ownerHash, provider, cartHash, JSON.stringify(lines), amount, time, time + 2700, time),
        ...lines.filter(l => l.original).map(l => db.prepare('INSERT INTO payment_original_reservations (product_id,order_id) VALUES (?,?)').bind(l.id, input.requestId))
      ]);
    } catch {
      order = await db.prepare('SELECT * FROM payment_orders WHERE id=?').bind(input.requestId).first<PaymentOrder>();
      if (!order) throw new PaymentError('An original is already reserved. Please try again later or contact the studio.', 409);
    }
    order ??= await db.prepare('SELECT * FROM payment_orders WHERE id=?').bind(input.requestId).first<PaymentOrder>();
  }
  if (!order || order.owner_hash !== ownerHash || order.cart_hash !== cartHash || order.provider !== provider) throw new PaymentError('Checkout request does not match this cart. Return to your cart and retry.', 409);
  if (order.status !== 'PendingPayment' || order.expires_at <= time) throw new PaymentError('This checkout has ended. Please contact the studio if an original remains reserved.', 409);
  if (order.provider_id && order.approval_url) return json({ url: order.approval_url, orderId: order.id });
  // Keep reservations on ambiguous provider failures: the same request can safely retry.
  const session = await createProviderCheckout(order, new URL(request.url).origin, env, fetcher);
  await db.prepare('UPDATE payment_orders SET provider_id=?,approval_url=?,updated_at=? WHERE id=? AND provider_id IS NULL').bind(session.id, session.url, now(), order.id).run();
  return json({ url: session.url, orderId: order.id });
}
async function webhook(request: Request, env: PaymentEnvironment, provider: Provider, fetcher: typeof fetch) {
  if (!readiness(env)[provider]) throw new PaymentError('Webhook is not configured.', 503);
  const raw = await boundedText(request, 262144);
  if (provider === 'stripe' && !await verifyStripe(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET!)) throw new PaymentError('Invalid signature.', 400);
  let event;
  try { event = JSON.parse(raw); } catch { throw new PaymentError('Invalid event.', 400); }
  if (provider === 'paypal' && !await verifyPayPal(event, request.headers, env, fetcher)) throw new PaymentError('Invalid signature.', 400);
  if (typeof event?.id !== 'string' || event.id.length > 255) throw new PaymentError('Invalid event.', 400);
  const type = provider === 'stripe' ? event.type : event.event_type;
  const accepted = provider === 'stripe' ? ['checkout.session.completed', 'checkout.session.expired'] : ['PAYMENT.CAPTURE.COMPLETED'];
  if (!accepted.includes(type)) return json({ received: true });
  const providerId = provider === 'stripe' ? event.data?.object?.id : event.resource?.supplementary_data?.related_ids?.order_id;
  if (typeof providerId !== 'string') throw new PaymentError('Missing payment reference.', 400);
  const order = await env.PAYMENTS_DB.prepare('SELECT * FROM payment_orders WHERE provider=? AND provider_id=?').bind(provider, providerId).first<PaymentOrder>();
  if (!order) throw new PaymentError('Payment is not recorded yet.', 409);
  const state = provider === 'stripe' ? stripeState(event.data.object, order) : await retrieveState(order, env, fetcher);
  await applyState(env, order, state, { id: event.id, type });
  return json({ received: true });
}
export async function paymentRequest(request: Request, env: PaymentEnvironment, products: Product[], fetcher: typeof fetch = fetch): Promise<Response> {
  try {
    const url = new URL(request.url), path = url.pathname;
    if (path.endsWith('/webhook')) {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      if (path === '/api/shop/stripe/webhook') return await webhook(request, env, 'stripe', fetcher);
      if (path === '/api/shop/paypal/webhook') return await webhook(request, env, 'paypal', fetcher);
      return json({ error: 'Not found.' }, 404);
    }
    const rate = await env.PAYMENT_RATE_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' });
    if (!rate.success) throw new PaymentError('Please wait a minute and try again.', 429);
    if (request.method === 'POST') {
      if (path === '/api/shop/checkout' && !readiness(env).stripe && !readiness(env).paypal) throw new PaymentError('Test checkout is not configured yet. Your cart is saved.', 503);
      if (request.headers.get('Origin') !== url.origin || request.headers.get('X-Lakeland-Cart') !== '1') throw new PaymentError('Please submit checkout from this site.', 403);
      if (path === '/api/shop/checkout') return await checkout(request, env, products, fetcher);
      if (path === '/api/shop/paypal/capture') {
        const order = await ownedOrder(request, env, (await body(request))?.orderId);
        if (order.provider !== 'paypal' || !readiness(env).paypal || !order.provider_id) throw new PaymentError('PayPal checkout is unavailable.', 503);
        if (order.status === 'PendingPayment') {
          let state;
          try { state = await capturePayPal(order, env, fetcher); }
          catch (error) { state = await retrieveState(order, env, fetcher); if (!state) throw error; }
          await applyState(env, order, state);
        }
        return json({ accepted: true });
      }
    }
    if (request.method === 'GET' && path === '/api/shop/checkout/status') {
      const order = await ownedOrder(request, env, url.searchParams.get('orderId'));
      if (order.status === 'PendingPayment' && readiness(env)[order.provider]) await applyState(env, order, await retrieveState(order, env, fetcher));
      const current = await ownedOrder(request, env, order.id);
      return json({ status: current.status, provider: current.provider, test: true });
    }
    return json({ error: 'Not found or method not allowed.' }, 404);
  } catch (error) {
    if (error instanceof PaymentError) return json({ error: error.message }, error.status);
    console.error('Payment request failed', error instanceof Error ? error.name : 'UnknownError');
    return json({ error: 'Checkout is temporarily unavailable. Your cart is saved.' }, 503);
  }
}
