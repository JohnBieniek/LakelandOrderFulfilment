const { test, expect } = require('@playwright/test');

test('home and responsive navigation render without browser errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Art that feels like you.' })).toBeVisible();
  await page.getByRole('link', { name: 'Find your piece' }).click();
  await expect(page.locator('.product-card')).toHaveCount(6);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('products filter by artist and category and sort by price', async ({ page }) => {
  await page.goto('/products');
  await page.getByLabel('Artist', { exact: true }).selectOption('Studio sculptor');
  await expect(page.locator('.product-card')).toHaveCount(2);
  await page.getByLabel('Sort by').selectOption('price-low');
  await expect(page.locator('.product-card h3').first()).toHaveText('Little woodland spirit');
  await page.getByLabel('Artist', { exact: true }).selectOption('');
  await page.getByRole('button', { name: 'Print on demand', exact: true }).click();
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(page.locator('.product-card h3')).toHaveText('The everyday art mug');
  await expect(page.locator('.shipping')).toContainText('Estimated ship date');
});

test('fan art is display-only and artist filters apply', async ({ page }) => {
  await page.goto('/gallery?section=fan');
  await expect(page.locator('.fan-section .gallery-card')).toHaveCount(2);
  await expect(page.locator('.fan-section [data-add]')).toHaveCount(0);
  await expect(page.locator('.fan-section a[href*="products"]')).toHaveCount(0);
  await page.getByLabel('Artist', { exact: true }).selectOption('Studio painter');
  await expect(page.locator('.fan-section .gallery-card')).toHaveCount(1);
});

test('mixed cart persists, limits originals to one, and supports quantity and removal', async ({ page }) => {
  await page.goto('/products');
  await page.getByRole('button', { name: 'Add Where the water settles to cart' }).click();
  await page.getByRole('button', { name: 'Add Where the water settles to cart' }).click();
  await page.getByRole('button', { name: 'Add The quiet companion to cart' }).click();
  await page.getByRole('button', { name: 'Add The everyday art mug to cart' }).click();
  await page.getByRole('link', { name: 'Cart, 3 items', exact: true }).click();
  await expect(page.locator('.cart-item')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Increase quantity of Where the water settles' })).toBeDisabled();
  await page.getByRole('button', { name: 'Increase quantity of The everyday art mug' }).click();
  await expect(page.locator('#cart-count')).toHaveText('4');
  await page.reload();
  await expect(page.locator('#cart-count')).toHaveText('4');
  await expect(page.getByRole('button', { name: 'Test checkout coming soon' })).toBeDisabled();
  await page.locator('.cart-item').filter({ hasText: 'The quiet companion' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.cart-item')).toHaveCount(2);
});

test('direct page routes and contact form are usable', async ({ page, request }) => {
  for (const route of ['/gallery', '/products', '/contact', '/cart']) expect((await request.get(route)).ok()).toBeTruthy();
  await page.goto('/contact');
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveAttribute('type', 'email');
  await expect(page.getByRole('button', { name: 'Open your email app' })).toBeVisible();
  expect((await request.get('/api/orders/11111111-1111-1111-1111-111111111111')).status()).toBe(404);
  expect((await request.post('/api/shop/checkout', { data: { requestId: '11111111-1111-1111-1111-111111111111', items: [] } })).status()).toBe(503);
});

test('capture desktop and mobile previews', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.locator('.hero-art img')).toBeVisible();
  await page.screenshot({ path: 'artifacts/beta-home-desktop.png', fullPage: true });
  await page.goto('/products');
  await expect(page.locator('.product-card')).toHaveCount(6);
  await page.screenshot({ path: 'artifacts/beta-products-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.hero-art img')).toBeVisible();
  await page.screenshot({ path: 'artifacts/beta-home-mobile.png', fullPage: true });
});
