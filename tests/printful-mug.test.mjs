import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, inspect, prepare, recipient, PrintfulError } from '../scripts/printful-mug.mjs';

const address = { name:'Test Buyer', address1:'123 Test Lane', city:'Test City', state_code:'MI', country_code:'US', zip:'49001' };
function fixture() {
  const calls = []; let order;
  const variant = { id:123, name:'Studio design / 11 oz', synced:true, product:{name:'White glossy mug'}, files:[{type:'default',status:'ok'}] };
  const api = async (path, method='GET', body) => {
    calls.push({path,method,body});
    if (path === '/store/variants/123') return {result:{sync_variant:variant,sync_product:{name:'Studio mug'}}};
    if (path === '/orders/estimate-costs') return {result:{costs:{currency:'USD',total:'17.50'}}};
    if (path.startsWith('/orders/@')) { if (!order) throw new PrintfulError(404); return {result:order}; }
    if (path === '/orders?confirm=false') { order={id:999,status:'draft',...body,costs:{currency:'USD',total:'17.50'}}; return {result:order}; }
    throw new Error('Unexpected request');
  };
  return {api,calls,variant};
}
test('fixed API client refuses confirmation, arbitrary origins, and unsupported methods', async()=>{
  const calls=[];
  const api=client('private-fixture',async(url,init)=>{calls.push({url,init});return Response.json({code:200,result:[]});});
  await api('/stores');
  assert.equal(calls[0].url,'https://api.printful.com/stores');
  assert.equal(calls[0].init.headers['X-PF-Store-Id'],'18691434');
  for (const path of ['/orders/1/confirm','/orders?confirm=true','https://example.com']) await assert.rejects(api(path,'POST'),/Unsupported/);
  await assert.rejects(api('/stores','DELETE'),/Unsupported/);
  assert.equal(calls.length,1);
});
test('provider errors do not echo credentials, addresses, or response bodies', async()=>{
  const api=client('private-fixture',async()=>new Response('sensitive body',{status:403}));
  await assert.rejects(api('/stores'),error=>error.message.includes('403')&&!error.message.includes('sensitive')&&!error.message.includes('private-fixture'));
});
test('quote uses one configured mug and strips unapproved recipient properties',async()=>{
  const f=fixture();
  const quote=await prepare(f.api,{action:'quote',variantId:123,address:{...address,confirm:true,files:['private-original']}});
  assert.equal(quote.costs.total,'17.50');
  assert.deepEqual(f.calls[1].body,{recipient:address,items:[{sync_variant_id:123,quantity:1}],shipping:'STANDARD'});
  assert.equal(f.calls.some(c=>c.path==='/orders?confirm=false'),false);
});
test('draft creation is unconfirmed and retries reuse the same external reference',async()=>{
  const f=fixture(), options={action:'draft',variantId:123,address,reference:'lakeland-mug-test12345'};
  const first=await prepare(f.api,options), second=await prepare(f.api,options);
  assert.equal(first.status,'draft'); assert.equal(first.id,second.id);
  assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  await assert.rejects(prepare(f.api,{...options,address:{...address,name:'Different person'}}),/differs/);
});
test('invalid mappings, print files, addresses and references fail before order submission',async()=>{
  const f=fixture(), options={action:'draft',variantId:123,address,reference:'lakeland-mug-test12345'};
  await assert.rejects(prepare(f.api,{...options,reference:'invalid'}),/stable reference/);
  f.variant.files[0].status='waiting';
  await assert.rejects(prepare(f.api,options),/not ready/);
  f.variant.files[0].status='ok'; f.variant.product.name='T-shirt';
  await assert.rejects(prepare(f.api,options),/synced mug/);
  assert.throws(()=>recipient({...address,state_code:''}),/state/);
  assert.equal(f.calls.some(c=>c.method==='POST'),false);
});
test('store inspection excludes private print file links',async()=>{
  const result=await inspect(async path=>{
    if(path==='/stores') return {result:[{id:18691434,name:'Personal orders'}]};
    if(path.startsWith('/store/products?')) return {result:[{id:1,name:'Mug'}],paging:{total:1}};
    return {result:{sync_variants:[{id:123,name:'11 oz',synced:true,variant_id:456,files:[{url:'private-original'}]}]}};
  });
  assert.equal(result.products[0].variants[0].syncVariantId,123);
  assert.equal(JSON.stringify(result).includes('private-original'),false);
});
