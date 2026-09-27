const { test, expect } = require('@playwright/test');

async function enabledCatalog(page) {
  await page.route('**/api/shop/catalog', async route => {
    const response = await route.fetch(), catalog = await response.json();
    await route.fulfill({ response, json: { ...catalog, shippingRequired: false, checkoutReady: true, paymentProviders: {stripe:true,paypal:true} } });
  });
}
test('both hosted payment choices send cart IDs and reuse their request on retry', async ({ page }) => {
  await enabledCatalog(page);
  const requests=[];
  await page.route('**/api/shop/checkout', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({status:503,json:{error:'Test provider unavailable. Your cart is saved.'}});
  });
  await page.goto('/products');
  await page.getByRole('button',{name:'Add Beekeeper and Doctor Mug / 11 oz to cart'}).click();
  await page.getByRole('link',{name:'Cart, 1 item',exact:true}).click();
  await expect(page.locator('#checkout-button')).toBeEnabled();
  await expect(page.locator('#paypal-checkout-button')).toBeEnabled();
  await page.locator('#checkout-button').click();
  await expect(page.locator('#checkout-error')).toContainText('Your cart is saved');
  await page.locator('#checkout-button').click();
  await expect.poll(()=>requests.length).toBe(2);
  expect(requests[0].requestId).toBe(requests[1].requestId);
  expect(requests[0].provider).toBe('stripe');
  expect(Object.keys(requests[0].items[0]).sort()).toEqual(['productVariantId','quantity']);
  await expect(page.locator('#paypal-checkout-button')).toBeEnabled();
  await page.locator('#paypal-checkout-button').click();
  await expect.poll(()=>requests.length).toBe(3);
  expect(requests[2].provider).toBe('paypal');
  expect(requests[2].requestId).not.toBe(requests[0].requestId);
  await expect(page.locator('.cart-item')).toHaveCount(1);
});
test('PayPal return captures before verification and never treats a redirect as paid', async ({page}) => {
  const calls=[];
  await page.route('**/api/shop/paypal/capture',async route=>{
    calls.push({type:'capture',body:route.request().postDataJSON()});
    await route.fulfill({json:{accepted:true}});
  });
  await page.route('**/api/shop/checkout/status?*',async route=>{
    calls.push({type:'status'});
    await route.fulfill({json:{status:'PendingPayment',provider:'paypal'}});
  });
  await page.goto('/checkout/success?provider=paypal&order_id=11111111-1111-4111-8111-111111111111&token=UNTRUSTED');
  await expect(page.locator('#payment-status')).toContainText('waiting for payment confirmation');
  expect(calls[0]).toEqual({type:'capture',body:{orderId:'11111111-1111-4111-8111-111111111111'}});
  expect(calls[1].type).toBe('status');
  await expect(page.locator('h1')).toHaveText('One moment, art lover.');
});
test('checkout rejects a provider redirect to an unrelated site', async ({page})=>{
  await enabledCatalog(page);
  await page.route('**/api/shop/checkout',route=>route.fulfill({json:{url:'https://example.com/steal'}}));
  await page.goto('/products');
  await page.getByRole('button',{name:'Add Beekeeper and Doctor Mug / 11 oz to cart'}).click();
  await page.getByRole('link',{name:'Cart, 1 item',exact:true}).click();
  await page.locator('#paypal-checkout-button').click();
  await expect(page.locator('#checkout-error')).toContainText('unexpected address');
  await expect(page).toHaveURL(/\/cart$/);
});
async function shippingCart(page) {
  await page.route('**/api/shop/catalog', async route => {
    const response=await route.fetch(), catalog=await response.json();
    await route.fulfill({response,json:{...catalog,shippingRequired:true,checkoutReady:true,paymentProviders:{stripe:false,paypal:true}}});
  });
  await page.goto('/products');
  await page.getByRole('button',{name:'Add Beekeeper and Doctor Mug / 11 oz to cart'}).click();
  await page.getByRole('link',{name:'Cart, 1 item',exact:true}).click();
  await page.getByLabel('Full name',{exact:true}).fill('Sandbox Buyer');
  await page.getByLabel('Street address',{exact:true}).fill('123 Test Street');
  await page.getByLabel('City',{exact:true}).fill('Lansing');
  await page.getByLabel('State',{exact:true}).selectOption('MI');
  await page.getByLabel('ZIP code',{exact:true}).fill('48933');
}
const quoteResult=()=>({quoteId:'33333333-3333-4333-8333-333333333333',shippingCents:669,subtotalCents:950,totalCents:1619,currency:'USD',expiresAt:Math.floor(Date.now()/1000)+900,taxStatus:'not-configured'});
test('US shipping is reviewed before PayPal and address/cart edits invalidate the quote',async({page})=>{
  const quotes=[],checkouts=[];
  await page.route('**/api/shop/shipping/quote',route=>{
    quotes.push(route.request().postDataJSON());
    return route.fulfill({json:quoteResult()});
  });
  await page.route('**/api/shop/checkout',route=>{
    checkouts.push(route.request().postDataJSON());
    return route.fulfill({status:503,json:{error:'Test provider unavailable.'}});
  });
  await shippingCart(page);
  await expect(page.locator('#paypal-checkout-button')).toBeDisabled();
  await expect(page.locator('#shipping-form')).toContainText('United States only');
  await page.getByRole('button',{name:'Calculate shipping',exact:true}).click();
  await expect(page.locator('#shipping-cost')).toHaveText('$6.69');
  await expect(page.locator('#checkout-total')).toHaveText('$16.19');
  await expect(page.locator('#shipping-status')).toContainText('sales tax is not included');
  expect(quotes[0].address.country_code).toBe('US');
  expect(quotes[0].items[0].quantity).toBe(1);
  await page.locator('#paypal-checkout-button').click();
  await expect(page.locator('#checkout-error')).toHaveText('Test provider unavailable.');
  expect(checkouts[0].quoteId).toBe(quoteResult().quoteId);
  expect(checkouts[0]).not.toHaveProperty('shippingCents');
  expect(checkouts[0]).not.toHaveProperty('address');
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('123 Test Street');
  await page.getByLabel('ZIP code',{exact:true}).fill('48910');
  await expect(page.locator('#paypal-checkout-button')).toBeDisabled();
  await expect(page.locator('#shipping-cost')).toHaveText('Calculate above');
  await page.getByRole('button',{name:'Calculate shipping',exact:true}).click();
  await expect(page.locator('#paypal-checkout-button')).toBeEnabled();
  await page.getByRole('button',{name:'Increase quantity of Beekeeper and Doctor Mug / 11 oz'}).click();
  await expect(page.locator('#paypal-checkout-button')).toBeDisabled();
  await expect(page.getByLabel('ZIP code',{exact:true})).toHaveValue('48910');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'artifacts/us-shipping-mobile.png',fullPage:true});
});
test('late shipping responses cannot enable checkout after an address edit',async({page})=>{
  let release,started;
  const pending=new Promise(resolve=>{release=resolve;});
  const arrived=new Promise(resolve=>{started=resolve;});
  await page.route('**/api/shop/shipping/quote',async route=>{started();await pending;await route.fulfill({json:quoteResult()});});
  await shippingCart(page);
  await page.getByRole('button',{name:'Calculate shipping',exact:true}).click();
  await arrived;
  await page.getByLabel('ZIP code',{exact:true}).fill('48910');
  release();
  await expect(page.getByRole('button',{name:'Calculate shipping',exact:true})).toBeEnabled();
  await expect(page.locator('#paypal-checkout-button')).toBeDisabled();
  await expect(page.locator('#shipping-cost')).toHaveText('Calculate above');
});
test('shipping errors retain the address and expired quotes cannot start checkout',async({page})=>{
  let fail=true,checkouts=0;
  await page.route('**/api/shop/shipping/quote',route=>route.fulfill(fail?{status:503,json:{error:'Shipping provider unavailable.'}}:{json:{...quoteResult(),expiresAt:1}}));
  await page.route('**/api/shop/checkout',route=>{checkouts++;return route.fulfill({status:503,json:{error:'Should not be called'}});});
  await shippingCart(page);
  await page.getByRole('button',{name:'Calculate shipping',exact:true}).click();
  await expect(page.locator('#shipping-status')).toHaveText('Shipping provider unavailable.');
  await expect(page.getByLabel('Street address',{exact:true})).toHaveValue('123 Test Street');
  await expect(page.locator('#paypal-checkout-button')).toBeDisabled();
  fail=false;
  await page.getByRole('button',{name:'Calculate shipping',exact:true}).click();
  await page.locator('#paypal-checkout-button').click();
  await expect(page.locator('#checkout-error')).toContainText('fresh shipping quote');
  expect(checkouts).toBe(0);
});
