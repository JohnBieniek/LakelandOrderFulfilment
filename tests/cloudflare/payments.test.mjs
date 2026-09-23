import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { paymentRequest, applyState, setOwnerCookie } from '../../cloudflare/payments.ts';
import { readiness, stripeState, paypalState, verifyStripe, allowedRedirect } from '../../cloudflare/payment-providers.ts';

const origin = 'https://studio.example';
const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const products = [{id: 'painting', name: 'Painting', price: 420, isOriginal: true}, {id: 'mug', name: 'Mug', price: 24, isOriginal: false}];
function environment() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync(new URL('../../cloudflare/migrations/0001_test_payments.sql', import.meta.url), 'utf8'));
  const prepare = sql => {
    let values = [];
    const statement = {
      bind(...args) { values = args; return statement; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { return sqlite.prepare(sql).run(...values); }
    };
    return statement;
  };
  return { sqlite, PAYMENTS_ENABLED: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    PAYPAL_CLIENT_ID: 'fixture', PAYPAL_CLIENT_SECRET: 'fixture', PAYPAL_WEBHOOK_ID: 'fixture',
    PAYMENT_RATE_LIMIT: { async limit() { return {success: true}; } },
    PAYMENTS_DB: { prepare, async batch(statements) { sqlite.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; } catch(error) { sqlite.exec('ROLLBACK'); throw error; } } }
  };
}
function request(path, value, headers = {}) {
  return new Request(origin + '/api/shop/' + path, { method: value === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Lakeland-Cart': '1', Cookie: 'lakeland_payment_owner=' + 'a'.repeat(64), ...headers },
    ...(value === undefined ? {} : {body: JSON.stringify(value)}) });
}
const cart = (provider = 'stripe', requestId = id, item = 'painting') => ({provider, requestId, items:[{productVariantId: item, quantity: 1}]});
function mockProvider() {
  const calls = [];
  const sessions = new Map();
  let paid = false;
  const fetcher = async (url, init = {}) => {
    calls.push({url, init});
    if (url.endsWith('/oauth2/token')) return Response.json({access_token:'token'});
    if (url.endsWith('/verify-webhook-signature')) return Response.json({verification_status:'SUCCESS'});
    if (url.endsWith('/checkout/sessions') && init.method === 'POST') {
      const fields = new URLSearchParams(init.body), orderId = fields.get('client_reference_id');
      let amount = 0;
      for (let i=0; fields.has(`line_items[${i}][quantity]`); i++) amount += Number(fields.get(`line_items[${i}][quantity]`)) * Number(fields.get(`line_items[${i}][price_data][unit_amount]`));
      const session = {id:'cs_test_' + orderId, livemode:false, client_reference_id:orderId, metadata:{order_id:orderId,environment:'lakeland-beta'}, amount_total:amount,currency:'usd',url:'https://checkout.stripe.com/c/test'};
      sessions.set(session.id, session);
      return Response.json(session);
    }
    if (url.includes('/checkout/sessions/')) return Response.json({...sessions.get(url.split('/').at(-1)), status:paid?'complete':'open',payment_status:paid?'paid':'unpaid'});
    if (url.endsWith('/v2/checkout/orders')) {
      const data = JSON.parse(init.body);
      sessions.set('PAYPAL123', {id:'PAYPAL123',purchase_units:data.purchase_units});
      return Response.json({id:'PAYPAL123',links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL123'}]});
    }
    if (url.includes('/v2/checkout/orders/PAYPAL123')) {
      const data = structuredClone(sessions.get('PAYPAL123'));
      data.status = paid ? 'COMPLETED' : 'APPROVED';
      if (paid) data.purchase_units[0].payments = {captures:[{status:'COMPLETED', amount:data.purchase_units[0].amount}]};
      return Response.json(data);
    }
    throw new Error('Unexpected provider URL: ' + url);
  };
  return {fetcher,calls,sessions,setPaid(){paid=true;}};
}
const send = (env, mock, req) => paymentRequest(req, env, products, mock.fetcher);
const stored = env => env.sqlite.prepare('SELECT * FROM payment_orders WHERE id=?').get(id);

test('configuration fails closed and never permits Stripe live keys', () => {
  assert.deepEqual(readiness({}), {stripe:false,paypal:false});
  assert.equal(readiness({...environment(), STRIPE_SECRET_KEY:'sk_live_no'}).stripe,false);
  assert.deepEqual(readiness({...environment(), PAYMENTS_ENABLED:'live'}),{stripe:false,paypal:false});
  assert.equal(allowedRedirect('https://checkout.stripe.com.evil.test','stripe'),false);
  assert.equal(allowedRedirect('https://www.paypal.com/checkoutnow','paypal'),false);
  assert.equal(allowedRedirect('https://checkout.stripe.com:444/test','stripe'),false);
});
test('owner cookie is HttpOnly, secure and not replaced during checkout', () => {
  const response = setOwnerCookie(new Request(origin), new Response());
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax; Path=\/; Max-Age=604800; Secure/);
  assert.equal(setOwnerCookie(request('catalog'),new Response()).headers.get('Set-Cookie'),null);
});
test('server prices, stable retries, and original reservations are enforced atomically', async () => {
  const env = environment(), mock=mockProvider();
  assert.equal((await send(env,mock,request('checkout',{...cart(),amount:1,price:0}))).status,200);
  assert.equal(stored(env).amount_cents,42000);
  assert.equal((await send(env,mock,request('checkout',cart()))).status,200);
  assert.equal(mock.calls.length,1);
  assert.equal((await send(env,mock,request('checkout',cart('stripe',secondId)))).status,409);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM payment_orders').get().n,1);
  assert.equal((await send(env,mock,request('checkout',cart('paypal')))).status,409);
});
test('cross-origin, missing owner, invalid carts and foreign status requests cannot make payments', async () => {
  const env=environment(), mock=mockProvider();
  assert.equal((await send(env,mock,request('checkout',cart(),{Origin:'https://evil.test'}))).status,403);
  assert.equal((await send(env,mock,request('checkout',cart(),{Cookie:''}))).status,403);
  assert.equal((await send(env,mock,request('checkout',{...cart(),items:[...cart().items,...cart().items]}))).status,400);
  assert.equal((await send(env,mock,request('checkout',cart('stripe',id,'fan-art')))).status,400);
  assert.equal(mock.calls.length,0);
  await send(env,mock,request('checkout',cart()));
  assert.equal((await send(env,mock,request('checkout/status?orderId='+id,undefined,{Cookie:'lakeland_payment_owner='+'b'.repeat(64)}))).status,404);
});
test('provider failures keep the same durable order and reservation for retry', async () => {
  const env=environment(), mock=mockProvider();
  assert.equal((await paymentRequest(request('checkout',cart()),env,products,async()=>new Response('',{status:500}))).status,502);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM payment_original_reservations').get().n,1);
  assert.equal((await send(env,mock,request('checkout',cart()))).status,200);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM payment_orders').get().n,1);
});
test('authenticated status reconciliation records payment once and never downgrades paid orders', async () => {
  const env=environment(), mock=mockProvider();
  await send(env,mock,request('checkout',cart()));
  assert.equal((await (await send(env,mock,request('checkout/status?orderId='+id))).json()).status,'PendingPayment');
  mock.setPaid();
  assert.equal((await (await send(env,mock,request('checkout/status?orderId='+id))).json()).status,'Paid');
  await applyState(env,stored(env),'Paid',{id:'evt_1',type:'checkout.session.completed'});
  await applyState(env,stored(env),'Paid',{id:'evt_1',type:'checkout.session.completed'});
  await applyState(env,stored(env),'Canceled');
  assert.equal(stored(env).status,'Paid');
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM payment_test_outbox').get().n,1);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM payment_events').get().n,1);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM payment_original_reservations').get().n,1);
});
test('Stripe webhook signatures reject forged, tampered and stale events', async () => {
  const env=environment(), mock=mockProvider();
  await send(env,mock,request('checkout',cart()));
  const event={id:'evt_1',type:'checkout.session.completed',data:{object:{...mock.sessions.get(stored(env).provider_id),status:'complete',payment_status:'paid'}}};
  const raw=JSON.stringify(event), timestamp=Math.floor(Date.now()/1000);
  const signature='t='+timestamp+',v1='+createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(timestamp+'.'+raw).digest('hex');
  assert.equal(await verifyStripe(raw,signature,env.STRIPE_WEBHOOK_SECRET),true);
  assert.equal(await verifyStripe(raw+' ',signature,env.STRIPE_WEBHOOK_SECRET),false);
  assert.equal(await verifyStripe(raw,signature,env.STRIPE_WEBHOOK_SECRET,(timestamp+301)*1000),false);
  assert.equal((await send(env,mock,request('stripe/webhook',event,{'stripe-signature':'forged'}))).status,400);
  assert.equal((await send(env,mock,request('stripe/webhook',event,{'stripe-signature':signature}))).status,200);
  assert.equal(stored(env).status,'Paid');
});
test('PayPal uses only sandbox, captures the stored order, and approval alone is unpaid', async () => {
  const env=environment(), mock=mockProvider();
  await send(env,mock,request('checkout',cart('paypal')));
  await send(env,mock,request('paypal/capture',{orderId:id,token:'ATTACKER_ORDER'}));
  assert.equal(stored(env).status,'PendingPayment');
  mock.setPaid();
  assert.equal((await send(env,mock,request('paypal/capture',{orderId:id}))).status,200);
  assert.equal(stored(env).status,'Paid');
  assert.ok(mock.calls.every(c=>new URL(c.url).hostname==='api-m.sandbox.paypal.com'));
  const captures=mock.calls.filter(c=>c.url.endsWith('/capture'));
  assert.ok(captures.every(c=>c.url.endsWith('/PAYPAL123/capture')));
  assert.equal(captures[0].init.headers['PayPal-Request-Id'],captures[1].init.headers['PayPal-Request-Id']);
  assert.notEqual(captures[0].init.headers['PayPal-Request-Id'],id);
});
test('amount mismatch cannot mark Stripe or PayPal paid', () => {
  const order={id,provider_id:'provider',amount_cents:42000};
  assert.throws(()=>stripeState({id:'provider',livemode:false,client_reference_id:id,metadata:{order_id:id,environment:'lakeland-beta'},currency:'usd',amount_total:1,status:'complete',payment_status:'paid'},order));
  assert.throws(()=>paypalState({id:'provider',status:'COMPLETED',purchase_units:[{custom_id:id,reference_id:id,amount:{currency_code:'USD',value:'420.00'},payments:{captures:[{status:'COMPLETED',amount:{currency_code:'USD',value:'1.00'}}]}}]},order));
});
test('PayPal webhook verification fails closed and valid replay records only one payment', async () => {
  const env=environment(), mock=mockProvider();
  await send(env,mock,request('checkout',cart('paypal')));
  mock.setPaid();
  const event={id:'PAYPAL_EVENT',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{supplementary_data:{related_ids:{order_id:'PAYPAL123'}}}};
  const headers={'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://untrusted.example/cert','paypal-transmission-id':'transmission','paypal-transmission-sig':'signature','paypal-transmission-time':new Date().toISOString()};
  assert.equal((await send(env,mock,request('paypal/webhook',event))).status,400);
  const rejected=async(url,init)=>url.endsWith('/verify-webhook-signature')?Response.json({verification_status:'FAILURE'}):mock.fetcher(url,init);
  assert.equal((await paymentRequest(request('paypal/webhook',event,headers),env,products,rejected)).status,400);
  assert.equal(stored(env).status,'PendingPayment');
  assert.equal((await send(env,mock,request('paypal/webhook',event,headers))).status,200);
  assert.equal((await send(env,mock,request('paypal/webhook',event,headers))).status,200);
  assert.equal(stored(env).status,'Paid');
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM payment_test_outbox').get().n,1);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM payment_events').get().n,1);
  assert.ok(mock.calls.every(c=>new URL(c.url).hostname==='api-m.sandbox.paypal.com'));
});
test('confirmed expiration releases an original, late payment requires review', async () => {
  const env=environment(), mock=mockProvider();
  await send(env,mock,request('checkout',cart()));
  await applyState(env,stored(env),'Canceled');
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM payment_original_reservations').get().n,0);
  await applyState(env,stored(env),'Paid');
  assert.equal(stored(env).status,'Review');
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM payment_test_outbox').get().n,0);
});
