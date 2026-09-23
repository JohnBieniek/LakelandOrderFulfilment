const { test, expect } = require('@playwright/test');

async function enabledCatalog(page) {
  await page.route('**/api/shop/catalog', async route => {
    const response = await route.fetch(), catalog = await response.json();
    await route.fulfill({ response, json: { ...catalog, checkoutReady: true, paymentProviders: {stripe:true,paypal:true} } });
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
  await page.getByRole('button',{name:'Add The everyday art mug to cart'}).click();
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
  await page.getByRole('button',{name:'Add The everyday art mug to cart'}).click();
  await page.getByRole('link',{name:'Cart, 1 item',exact:true}).click();
  await page.locator('#paypal-checkout-button').click();
  await expect(page.locator('#checkout-error')).toContainText('unexpected address');
  await expect(page).toHaveURL(/\/cart$/);
});
