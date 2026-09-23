import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const storeId = 18691434;
export class PrintfulError extends Error {
  constructor(status) { super(`Printful request failed (HTTP ${status}). Check the store token, permissions and product/address details.`); this.status = status; }
}
export function client(token, fetcher = fetch) {
  if (!token) throw new Error('Printful token missing. Configure Providers:Printful:ApiToken in .NET user-secrets or Providers__Printful__ApiToken in the environment.');
  return async (path, method = 'GET', body) => {
    // Fixed origin; no arbitrary URLs, confirmation route, or credential logging.
    if (!/^\/(stores|store\/products(?:\?limit=100&offset=\d+|\/\d+)?|store\/variants\/\d+|orders\/estimate-costs|orders\?confirm=false|orders\/@[a-zA-Z0-9_-]+)$/.test(path)) throw new Error('Unsupported Printful operation.');
    if (method !== (['/orders/estimate-costs', '/orders?confirm=false'].includes(path) ? 'POST' : 'GET')) throw new Error('Unsupported Printful method.');
    const response = await fetcher('https://api.printful.com' + path, { method,
      headers: { Authorization: `Bearer ${token}`, 'X-PF-Store-Id': String(storeId), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) throw new PrintfulError(response.status);
    const data = await response.json();
    if (data.code !== 200 || data.result === undefined) throw new Error('Unexpected Printful response.');
    return data;
  };
}
export async function inspect(api) {
  const stores = (await api('/stores')).result;
  const store = stores.find(s => s.id === storeId);
  if (!store) throw new Error('The token cannot access the expected Printful store.');
  const products = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api(`/store/products?limit=100&offset=${offset}`);
    for (const product of page.result) {
      const detail = (await api('/store/products/' + product.id)).result;
      products.push({ id: product.id, name: product.name, variants: detail.sync_variants.map(v => ({
        syncVariantId: v.id, name: v.name, synced: v.synced, catalogVariantId: v.variant_id,
        price: v.retail_price, currency: v.currency
      })) });
    }
    if (offset + page.result.length >= page.paging.total || !page.result.length) break;
    if (offset >= 9900) throw new Error('Too many products to inspect in this tool.');
  }
  return { store: { id: store.id, name: store.name }, products };
}
export async function mugItem(api, variantId) {
  if (!Number.isSafeInteger(variantId) || variantId <= 0) throw new Error('Supply a positive Printful sync variant ID, not a catalog variant ID.');
  const { sync_variant: variant, sync_product: product } = (await api(`/store/variants/${variantId}`)).result;
  if (!variant || variant.id !== variantId || !variant.synced || variant.is_ignored || !/\bmug\b/i.test(variant.product?.name || '')) throw new Error('The selected variant must be a synced mug with its saved print design.');
  const files = variant.files?.filter(f => f.type !== 'preview');
  if (!files?.length || files.some(f => f.status !== 'ok')) throw new Error('The mug print files are missing or are not ready. Check its design in Printful.');
  return { item: { sync_variant_id: variantId, quantity: 1 }, name: product?.name || variant.name, variantName: variant.name };
}
export function recipient(value) {
  const fields = ['name', 'address1', 'address2', 'city', 'state_code', 'country_code', 'zip', 'email', 'phone'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Recipient must be a JSON object.');
  const result = Object.fromEntries(fields.filter(k => value[k] !== undefined).map(k => {
    if (typeof value[k] !== 'string' || value[k].length > 255 || /[\r\n]/.test(value[k])) throw new Error('Invalid recipient field.');
    return [k, value[k].trim()];
  }));
  for (const field of ['name', 'address1', 'city', 'country_code', 'zip']) if (!result[field]) throw new Error(`Recipient ${field} is required.`);
  if (!/^[A-Z]{2}$/.test(result.country_code)) throw new Error('Use a two-letter uppercase country code.');
  if (['US', 'CA'].includes(result.country_code) && !/^[A-Z]{2}$/.test(result.state_code || '')) throw new Error('Use a two-letter state/province code.');
  return result;
}
export async function prepare(api, { action, variantId, address, reference }) {
  if (!['quote', 'draft'].includes(action)) throw new Error('Choose quote or draft.');
  const selected = await mugItem(api, variantId);
  const payload = { recipient: recipient(address), items: [selected.item], shipping: 'STANDARD' };
  if (action === 'quote') {
    const data = (await api('/orders/estimate-costs', 'POST', payload)).result;
    return { name: selected.name, variant: selected.variantName, quantity: 1, costs: data.costs, note: 'Estimate only. No order created.' };
  }
  if (!/^lakeland-mug-[a-zA-Z0-9_-]{8,40}$/.test(reference || '')) throw new Error('Use a stable reference: lakeland-mug- followed by 8–40 letters, digits, underscores or hyphens. Reuse it on retries.');
  payload.external_id = reference;
  let order;
  try { order = (await api('/orders/@' + reference)).result; }
  catch (error) { if (!(error instanceof PrintfulError) || error.status !== 404) throw error; }
  if (!order) {
    try { order = (await api('/orders?confirm=false', 'POST', payload)).result; }
    catch (error) {
      // Recover an accepted request after an ambiguous network response, without posting again.
      try { order = (await api('/orders/@' + reference)).result; } catch { throw error; }
    }
  }
  if (order.external_id !== reference || order.status !== 'draft' || order.items?.length !== 1
      || order.items[0].sync_variant_id !== variantId || order.items[0].quantity !== 1
      || Object.entries(payload.recipient).some(([key, value]) => (order.recipient?.[key] || '') !== value))
    throw new Error('The existing order differs or is no longer a draft. Review it in Printful; do not retry with a new reference.');
  return { id: order.id, reference, status: order.status, name: selected.name, variant: selected.variantName, quantity: 1, costs: order.costs,
    note: 'Unconfirmed draft only. Review the design, address and final cost in Printful before paying.' };
}
async function tokenFromLocalConfiguration() {
  if (process.env.Providers__Printful__ApiToken) return process.env.Providers__Printful__ApiToken;
  const project = await readFile(new URL('../src/Lakeland.OrderFulfilment.Api/Lakeland.OrderFulfilment.Api.csproj', import.meta.url), 'utf8');
  const id = project.match(/<UserSecretsId>([^<]+)<\/UserSecretsId>/)?.[1];
  if (!id) return null;
  const path = process.env.APPDATA ? join(process.env.APPDATA, 'Microsoft', 'UserSecrets', id, 'secrets.json') : join(homedir(), '.microsoft', 'usersecrets', id, 'secrets.json');
  try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))['Providers:Printful:ApiToken']; }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Could not read the project user-secrets configuration.'); }
}
async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (!['inspect', 'quote', 'draft'].includes(action)) throw new Error('Usage: node scripts/printful-mug.mjs inspect | quote <syncVariantId> <recipient.json> | draft <syncVariantId> <recipient.json> <stable-reference>');
  const api = client(await tokenFromLocalConfiguration());
  const result = action === 'inspect' ? await inspect(api) : await prepare(api, {
    action, variantId: Number(args[0]), address: JSON.parse(await readFile(args[1], 'utf8')), reference: args[2]
  });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof PrintfulError ? error.message : error.message?.startsWith('fetch') ? 'Printful could not be reached. Reuse the same draft reference on retry.' : error.message); process.exitCode = 1; });
}
