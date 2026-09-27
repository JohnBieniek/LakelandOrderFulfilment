import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { paymentRequest, applyState, setOwnerCookie } from '../../cloudflare/payments.ts';
import { readiness, stripeState, paypalState, verifyStripe, allowedRedirect } from '../../cloudflare/payment-providers.ts';
import { processPrintfulDrafts, draftApi, enqueuePrintfulDraft, consumePrintfulDrafts } from '../../cloudflare/printful-drafts.ts';
import { shippingAddress, printfulShipping } from '../../cloudflare/shipping.ts';

const origin = 'https://studio.example';
const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const products = [{id: 'painting', name: 'Painting', price: 420, isOriginal: true}, {id: 'mug', name: 'Mug', price: 24, isOriginal: false}];
function environment() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync(new URL('../../cloudflare/migrations/0001_test_payments.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../cloudflare/migrations/0002_shipping_quotes.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../cloudflare/migrations/0003_printful_drafts.sql', import.meta.url), 'utf8'));
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
test('provider HTTP calls preserve the global fetch receiver', async () => {
  const env=environment(), mock=mockProvider();
  const fetcher=function(url,init) { assert.equal(this,globalThis); return mock.fetcher(url,init); };
  const response=await paymentRequest(request('checkout',cart('paypal')),env,products,fetcher);
  assert.equal(response.status,200);
  assert.equal(mock.calls.length,2);
});
test('provider redirects are returned manually and rejected without following them', async () => {
  const env=environment(); let calls=0;
  const fetcher=async(url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://untrusted.example/'}});};
  const response=await paymentRequest(request('checkout',cart('paypal')),env,products,fetcher);
  assert.equal(response.status,502);
  assert.equal(calls,1);
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
const shippingProducts = [{id:'b7777777-7777-4777-8777-777777777777',name:'11 oz mug',price:9.50,isOriginal:false}, ...products];
const usAddress = {name:'Sandbox Buyer',address1:'123 Test Street',address2:'',city:'Lansing',state_code:'MI',zip:'48933',country_code:'US'};
const shippingItems = [{productVariantId:shippingProducts[0].id,quantity:2}];
function shippingFixture() {
  const env = {...environment(), SHIPPING_MODE:'printful-us', PRINTFUL_API_TOKEN:'private-fixture'};
  const mock = mockProvider(), rateCalls = [];
  const fetcher = async (url, init) => {
    if (url === 'https://api.printful.com/shipping/rates') { rateCalls.push({url,init}); return Response.json({code:200,result:[{id:'STANDARD',rate:'6.49',currency:'USD'}]}); }
    return mock.fetcher(url,init);
  };
  const send = (path, input, headers) => paymentRequest(request(path,input,headers),env,shippingProducts,fetcher);
  return {env,mock,rateCalls,send};
}
test('US quote snapshots shipping, ignores client amounts, and sends PayPal the complete total and locked address', async()=>{
  const f=shippingFixture();
  const quote=await (await f.send('shipping/quote',{items:shippingItems,address:usAddress,shippingCents:0})).json();
  assert.equal(quote.shippingCents,649); assert.equal(quote.totalCents,2549);
  assert.equal(quote.taxStatus,'not-configured');
  assert.deepEqual(JSON.parse(f.rateCalls[0].init.body).items,[{variant_id:1320,quantity:2}]);
  assert.equal(f.rateCalls[0].init.headers['X-PF-Store-Id'],'18787964');
  assert.equal(f.rateCalls[0].init.redirect,'manual');
  const input={provider:'paypal',requestId:id,items:shippingItems,quoteId:quote.quoteId,shippingCents:0,amount:1,address:{...usAddress,country_code:'CA'}};
  assert.equal((await f.send('checkout',input)).status,200);
  const order=stored(f.env); assert.equal(order.amount_cents,2549); assert.equal(order.shipping_cents,649);
  const payload=JSON.parse(f.mock.calls.find(c=>c.url.endsWith('/v2/checkout/orders')).init.body);
  assert.equal(payload.purchase_units[0].amount.value,'25.49');
  assert.equal(payload.purchase_units[0].amount.breakdown.item_total.value,'19.00');
  assert.equal(payload.purchase_units[0].amount.breakdown.shipping.value,'6.49');
  assert.equal(payload.purchase_units[0].shipping.address.country_code,'US');
  assert.equal(payload.payment_source.paypal.experience_context.shipping_preference,'SET_PROVIDED_ADDRESS');
  f.env.sqlite.exec('DELETE FROM payment_shipping_quotes');
  assert.equal((await f.send('checkout',input)).status,200,'existing checkout retries use its immutable snapshot');
  assert.equal(f.mock.calls.filter(c=>c.url.endsWith('/v2/checkout/orders')).length,1);
  f.mock.setPaid();
  assert.equal((await f.send('checkout/status?orderId='+id)).status,200);
  assert.equal(stored(f.env).status,'Paid');
  assert.equal(f.env.sqlite.prepare('SELECT COUNT(*) n FROM payment_test_outbox').get().n,1);
});
test('missing, stolen, expired, changed-cart and changed-price quotes cannot create payment orders',async()=>{
  const f=shippingFixture(), input={provider:'paypal',requestId:id,items:shippingItems};
  assert.equal((await f.send('checkout',input)).status,400);
  const quote=await (await f.send('shipping/quote',{items:shippingItems,address:usAddress})).json();
  const quoted={...input,quoteId:quote.quoteId};
  assert.equal((await f.send('checkout',quoted,{Cookie:'lakeland_payment_owner='+'b'.repeat(64)})).status,409);
  assert.equal((await f.send('checkout',{...quoted,items:[{...shippingItems[0],quantity:1}]})).status,409);
  const changed=shippingProducts.map(p=>({...p,price:p.price+1}));
  assert.equal((await paymentRequest(request('checkout',quoted),f.env,changed,f.mock.fetcher)).status,409);
  f.env.sqlite.exec('UPDATE payment_shipping_quotes SET expires_at=0');
  assert.equal((await f.send('checkout',quoted)).status,409);
  assert.equal(f.env.sqlite.prepare('SELECT COUNT(*) n FROM payment_orders').get().n,0);
  assert.equal(f.mock.calls.length,0);
});
test('US-only address and supported mug cart validation fail before any shipping request',async()=>{
  const f=shippingFixture();
  for(const address of [{...usAddress,country_code:'CA'},{...usAddress,state_code:'PR'},{...usAddress,state_code:'AA'},{...usAddress,zip:'bad'},{...usAddress,address1:'\n'}])
    assert.equal((await f.send('shipping/quote',{items:shippingItems,address})).status,400);
  assert.equal((await f.send('shipping/quote',{items:[...shippingItems,{productVariantId:'painting',quantity:1}],address:usAddress})).status,400);
  assert.equal((await f.send('shipping/quote',{items:shippingItems,address:usAddress},{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.send('shipping/quote',{items:shippingItems,address:usAddress},{Cookie:''})).status,403);
  assert.equal(f.rateCalls.length,0);
  assert.equal(shippingAddress({...usAddress,state_code:'AK'}).state_code,'AK');
  assert.equal(shippingAddress({...usAddress,state_code:'HI'}).state_code,'HI');
  assert.equal(shippingAddress({...usAddress,state_code:'DC'}).state_code,'DC');
});
test('shipping provider errors, redirects, unsupported currency and malformed rates never become free shipping',async()=>{
  const lines=[{id:shippingProducts[0].id,quantity:1}];
  for(const response of [new Response('secret',{status:403}),new Response('',{status:302,headers:{Location:'https://evil.example'}}),Response.json({code:200,result:[]}),Response.json({code:200,result:[{id:'STANDARD',rate:'3.50',currency:'EUR'}]}),Response.json({code:200,result:[{id:'STANDARD',rate:'-1',currency:'USD'}]}),Response.json({code:200,result:[{id:'STANDARD',rate:'NaN',currency:'USD'}]})]) {
    await assert.rejects(printfulShipping(lines,usAddress,'private-fixture',async()=>response),error=>error.status===503&&!error.message.includes('secret')&&!error.message.includes('private-fixture'));
  }
  await assert.rejects(printfulShipping(lines,usAddress,undefined,async()=>{throw Error('must not call');}),/not configured/);
});
test('PayPal address changes are rejected before capture and cannot mark an order paid',async()=>{
  const f=shippingFixture();
  const quote=await (await f.send('shipping/quote',{items:shippingItems,address:usAddress})).json();
  await f.send('checkout',{provider:'paypal',requestId:id,items:shippingItems,quoteId:quote.quoteId});
  f.mock.sessions.get('PAYPAL123').purchase_units[0].shipping.address.country_code='CA';
  assert.equal((await f.send('paypal/capture',{orderId:id})).status,400);
  assert.equal(f.mock.calls.some(c=>c.url.endsWith('/capture')),false);
  f.mock.setPaid();
  assert.equal((await f.send('checkout/status?orderId='+id)).status,400);
  assert.equal(stored(f.env).status,'PendingPayment');
});
async function paidDraftFixture() {
  const f=shippingFixture(); f.env.PRINTFUL_DRAFT_MODE='draft-only';
  f.messages=[]; f.env.DRAFT_QUEUE={async send(message){f.messages.push(message);}};
  const quote=await (await f.send('shipping/quote',{items:shippingItems,address:usAddress})).json();
  await f.send('checkout',{provider:'paypal',requestId:id,items:shippingItems,quoteId:quote.quoteId});
  f.mock.setPaid(); await f.send('checkout/status?orderId='+id);
  return f;
}
function mockPrintful({lostResponse=false,badFiles=false,lookupFailure=false}={}) {
  const orders=new Map(),calls=[];
  const fetcher=async(url,init)=>{
    calls.push({url,init});
    if(url.includes('/store/variants/')) {
      const syncId=Number(url.split('/').at(-1));
      return Response.json({code:200,result:{sync_product_id:474191924,id:syncId,variant_id:1320,synced:true,files:[{type:'default',status:badFiles?'waiting':'ok'}]}});
    }
    if(url.includes('/orders/@')) {
      if(lookupFailure)return new Response('private provider data',{status:503});
      const order=orders.get(url.split('@').at(-1));
      return order?Response.json({code:200,result:order}):new Response('',{status:404});
    }
    assert.equal(url,'https://api.printful.com/orders?confirm=false&update_existing=false');
    assert.equal(init.method,'POST'); assert.equal(init.redirect,'manual');
    assert.equal(init.headers['X-PF-Store-Id'],'18787964');
    const payload=JSON.parse(init.body);
    assert.equal(payload.external_id.length,32);
    assert.equal(payload.items[0].sync_variant_id,5512359978);
    assert.equal(payload.items[0].quantity,2);
    assert.match(payload.packing_slip.message,/SANDBOX/);
    if(orders.has(payload.external_id))return new Response('',{status:409});
    const order={id:987654,status:'draft',...payload}; orders.set(payload.external_id,order);
    if(lostResponse)throw Error('private network failure');
    return Response.json({code:200,result:order});
  };
  return {orders,calls,fetcher};
}
const draftRow=f=>f.env.sqlite.prepare('SELECT * FROM payment_printful_drafts WHERE order_id=?').get(id);
test('verified payments create one unconfirmed Printful draft across concurrent runners and replay',async()=>{
  const f=await paidDraftFixture(),pf=mockPrintful();
  await Promise.all([processPrintfulDrafts(f.env,pf.fetcher),processPrintfulDrafts(f.env,pf.fetcher)]);
  await processPrintfulDrafts(f.env,pf.fetcher);
  assert.equal(draftRow(f).status,'Draft'); assert.equal(draftRow(f).printful_id,987654);
  assert.equal(pf.calls.filter(c=>c.init.method==='POST').length,1);
  assert.equal(pf.orders.size,1);
  assert.equal(stored(f.env).status,'Paid');
});
test('draft consumer fails closed for disabled mode, live mode, unpaid, Review or missing outbox orders',async()=>{
  const f=await paidDraftFixture(),pf=mockPrintful();
  for(const changes of [{PRINTFUL_DRAFT_MODE:undefined},{PRINTFUL_DRAFT_MODE:'live'},{PAYMENTS_ENABLED:'live'},{PRINTFUL_API_TOKEN:undefined}])
    await processPrintfulDrafts({...f.env,...changes},pf.fetcher);
  assert.equal(draftRow(f),undefined);
  for(const status of ['PendingPayment','Review','Canceled']) {
    f.env.sqlite.prepare('UPDATE payment_orders SET status=?').run(status);
    await processPrintfulDrafts(f.env,pf.fetcher);
    assert.equal(draftRow(f),undefined);
  }
  f.env.sqlite.exec("UPDATE payment_orders SET status='Paid'; DELETE FROM payment_test_outbox");
  await processPrintfulDrafts(f.env,pf.fetcher);
  assert.equal(draftRow(f),undefined); assert.equal(pf.calls.length,0);
});
test('lost Printful create responses recover the same draft without another POST',async()=>{
  const f=await paidDraftFixture(),pf=mockPrintful({lostResponse:true});
  await processPrintfulDrafts(f.env,pf.fetcher);
  assert.equal(draftRow(f).status,'Draft');
  assert.equal(pf.calls.filter(c=>c.init.method==='POST').length,1);
});
test('existing mismatched or confirmed Printful orders go to review and are never modified',async()=>{
  for(const mismatch of [{status:'pending'},{recipient:{...usAddress,country_code:'CA'}},{items:[{sync_variant_id:5512359979,quantity:2}]}]) {
    const f=await paidDraftFixture(),pf=mockPrintful();
    pf.orders.set(id.replaceAll('-',''),{id:999,status:'draft',external_id:id.replaceAll('-',''),shipping:'STANDARD',recipient:usAddress,items:[{sync_variant_id:5512359978,quantity:2}],...mismatch});
    await processPrintfulDrafts(f.env,pf.fetcher);
    assert.equal(draftRow(f).status,'Review');
    assert.equal(draftRow(f).last_error,'printful_order_needs_review');
    assert.equal(pf.calls.filter(c=>c.init.method==='POST').length,0);
  }
});
test('bad mappings and unready files never submit drafts',async()=>{
  const f=await paidDraftFixture(),pf=mockPrintful({badFiles:true});
  await processPrintfulDrafts(f.env,pf.fetcher);
  assert.equal(draftRow(f).status,'Review');
  assert.equal(pf.calls.filter(c=>c.init.method==='POST').length,0);
  const g=await paidDraftFixture();
  g.env.sqlite.prepare('UPDATE payment_orders SET lines_json=?').run(JSON.stringify([{id:'unknown',quantity:2,unitAmount:950,original:false}]));
  const other=mockPrintful(); await processPrintfulDrafts(g.env,other.fetcher);
  assert.equal(draftRow(g).status,'Review');assert.equal(other.calls.length,0);
});
test('Printful lookup failures back off, cap retries, and store only sanitized failure codes',async()=>{
  const f=await paidDraftFixture(),pf=mockPrintful({lookupFailure:true});let time=Math.floor(Date.now()/1000);
  for(let attempt=1;attempt<=5;attempt++){
    await processPrintfulDrafts(f.env,pf.fetcher,()=>time);
    assert.equal(draftRow(f).attempts,attempt);
    assert.equal(draftRow(f).status,attempt<5?'Retry':'Review');
    assert.equal(draftRow(f).last_error,'printful_http_503');
    time=draftRow(f).next_attempt_at+1;
  }
  assert.equal(pf.calls.filter(c=>c.init.method==='POST').length,0);
});
test('stale draft leases recover existing provider drafts without submitting twice',async()=>{
  const f=await paidDraftFixture(),pf=mockPrintful();
  await processPrintfulDrafts(f.env,pf.fetcher);
  f.env.sqlite.exec("UPDATE payment_printful_drafts SET status='Processing',lease_token='stale',lease_until=0,printful_id=NULL");
  await processPrintfulDrafts(f.env,pf.fetcher);
  assert.equal(draftRow(f).status,'Draft');assert.equal(draftRow(f).printful_id,987654);
  assert.equal(pf.calls.filter(c=>c.init.method==='POST').length,1);
});
test('draft transport refuses confirmation, updates and arbitrary endpoints',async()=>{
  let calls=0;
  for(const path of ['/orders/1/confirm','/orders?confirm=true','/orders','/orders/1','https://evil.example'])
    await assert.rejects(draftApi('private-token',path,undefined,async()=>{calls++;}),/unsupported_operation/);
  assert.equal(calls,0);
});

test('queue acknowledges completed drafts and retries transient failures',async()=>{
  for(const fails of [false,true]) {
    const f=await paidDraftFixture(),pf=mockPrintful({lookupFailure:fails});
    assert.ok(f.messages.some(message=>message.orderId===id));
    let ack=0,retry=0;
    const batch={messages:[{body:{orderId:id},ack(){ack++;},retry(options){retry++;assert.ok(options.delaySeconds>=60);}}]};
    await consumePrintfulDrafts(batch,f.env,pf.fetcher);
    assert.equal(ack,fails?0:1);assert.equal(retry,fails?1:0);
    if(!fails) {
      const before=f.messages.length;
      await enqueuePrintfulDraft(f.env,id);
      assert.equal(f.messages.length,before);
      await consumePrintfulDrafts(batch,f.env,pf.fetcher);
      assert.equal(pf.calls.filter(c=>c.init.method==='POST').length,1);
    }
  }
});

test('missing credentials do not acknowledge queued jobs; publication failures preserve paid records',async()=>{
  const f=await paidDraftFixture();let ack=0;
  await assert.rejects(consumePrintfulDrafts({messages:[{body:{orderId:id},ack(){ack++;}}]}, {...f.env,PRINTFUL_API_TOKEN:undefined}),/token is not configured/);
  assert.equal(ack,0);
  f.env.DRAFT_QUEUE={async send(){throw new Error('Queue unavailable');}};
  assert.equal((await f.send('checkout/status?orderId='+id)).status,503);
  assert.equal(stored(f.env).status,'Paid');
  f.env.DRAFT_QUEUE={async send(message){f.messages.push(message);}};
  const before=f.messages.length;
  assert.equal((await f.send('checkout/status?orderId='+id)).status,200);
  assert.ok(f.messages.length>before);
});
