import { boundedText, PaymentError } from './payment-providers.ts';
import type { PaymentLine } from './payment-providers.ts';
import { mugMappings, printfulStoreId } from './printful-catalog.ts';

export const usStates = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
export interface ShippingAddress { name: string; address1: string; address2: string; city: string; state_code: string; zip: string; country_code: 'US'; }
export interface ShippingQuote { id: string; owner_hash: string; cart_hash: string; address_json: string; shipping_cents: number; service: string; expires_at: number; }
export function shippingAddress(value: unknown): ShippingAddress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PaymentError('Enter your US shipping address.', 400);
  const input = value as Record<string, unknown>;
  const field = (key: string, max: number, optional = false) => {
    const raw = input[key] ?? (optional ? '' : null);
    if (typeof raw !== 'string' || raw.length > max || /[\x00-\x1f\x7f]/.test(raw) || (!optional && !raw.trim())) throw new PaymentError('Please complete a valid US shipping address.', 400);
    return raw.trim();
  };
  if (input.country_code !== 'US') throw new PaymentError('We currently ship within the United States only.', 400);
  const result: ShippingAddress = { name: field('name', 100), address1: field('address1', 100), address2: field('address2', 100, true), city: field('city', 100), state_code: field('state_code', 2).toUpperCase(), zip: field('zip', 10), country_code: 'US' };
  if (!usStates.includes(result.state_code) || !/^\d{5}(-\d{4})?$/.test(result.zip)) throw new PaymentError('Choose a US state or DC and enter a valid ZIP code. Territories and military addresses are not supported yet.', 400);
  return result;
}
export async function printfulShipping(lines: PaymentLine[], address: ShippingAddress, token: string | undefined, fetcher: typeof fetch) {
  if (!token) throw new PaymentError('Shipping quotes are not configured yet. Please try again later.', 503);
  if (lines.some(line => !mugMappings[line.id]) || lines.reduce((sum, line) => sum + line.quantity, 0) > 25)
    throw new PaymentError('Shipping checkout currently supports up to 25 Beekeeper and Doctor mugs. Please remove studio items or contact us about their shipping.', 400);
  const response = await fetcher.call(globalThis, 'https://api.printful.com/shipping/rates', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token}`, 'X-PF-Store-Id': String(printfulStoreId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: address, items: lines.map(line => ({ variant_id: mugMappings[line.id].catalogVariantId, quantity: line.quantity })), currency: 'USD', locale: 'en_US' })
  });
  if (!response.ok) throw new PaymentError('Printful could not quote shipping to this address. Check the address or try again later.', 503);
  let data;
  try { data = JSON.parse(await boundedText(response, 65536)); } catch { throw new PaymentError('Shipping quote unavailable. Please try again.', 503); }
  const rate = data.code === 200 && Array.isArray(data.result) ? data.result.find((r: {id?: string}) => r.id === 'STANDARD') : null;
  if (!rate || rate.currency !== 'USD' || typeof rate.rate !== 'string' || !/^\d{1,5}(\.\d{1,2})?$/.test(rate.rate))
    throw new PaymentError('Standard US shipping is unavailable for this address and cart.', 503);
  const cents = Math.round(Number(rate.rate) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100000) throw new PaymentError('Invalid shipping quote.', 503);
  return { cents, service: 'STANDARD' };
}
