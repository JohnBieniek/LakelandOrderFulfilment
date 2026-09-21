import catalog from './catalog.generated.json';
import { submitContact } from './contact';

const pageRoutes = new Set(['/contact', '/gallery', '/products', '/cart', '/checkout/success']);
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
};

export function addBusinessDays(now: Date, days: number): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  while (days > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) days--;
  }
  return date.toISOString().slice(0, 10);
}

export function previewCatalog(now = new Date()) {
  return {
    beta: true,
    currency: 'USD',
    checkoutReady: false,
    contactEmail: 'contact@lakelandfinearts.com',
    products: catalog.products.map(p => ({
      id: p.id, name: p.name, artist: p.artist, kind: p.kind, price: p.price,
      image: p.image, description: p.description, details: p.details, isSample: p.isSample,
      maxQuantity: p.isOriginal ? 1 : 25,
      available: true,
      estimate: {
        earliest: addBusinessDays(now, p.minBusinessDays),
        latest: addBusinessDays(now, p.maxBusinessDays),
        description: p.kind === 'clay' ? 'Handmade to order in our studio'
          : p.kind === 'printful' ? 'Printed and shipped by Printful' : 'Carefully packed and shipped by our studio'
      }
    })),
    gallery: catalog.gallery
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { ...securityHeaders, 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact') return submitContact(request, env);
    if (url.pathname === '/api/shop/checkout' && request.method === 'POST')
      return json({ error: 'Checkout is not enabled in this preview. Your cart is saved on this device.' }, 503);
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return json({ error: 'Method not allowed.' }, 405);
    if (url.pathname === '/health') return json({ status: 'healthy', mode: 'beta-preview', hosting: 'cloudflare' });
    if (url.pathname === '/api/shop/catalog') return json(previewCatalog());
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
    // Fetch the canonical root asset without triggering the asset service's /index.html -> / redirect.
    if (pageRoutes.has(url.pathname)) url.pathname = '/';
    const response = await env.ASSETS.fetch(new Request(url, request));
    const secured = new Response(response.body, response);
    for (const [name, value] of Object.entries(securityHeaders)) secured.headers.set(name, value);
    return secured;
  }
} satisfies ExportedHandler<Env>;
