import { boundedText } from './payment-providers.ts';
import type { PaymentOrder, PaymentLine, PaymentSecrets } from './payment-providers.ts';
import { shippingAddress } from './shipping.ts';
import type { ShippingAddress } from './shipping.ts';
import { mugMappings, printfulStoreId } from './printful-catalog.ts';

type DraftEnvironment = Pick<Env, 'PAYMENTS_DB'> & PaymentSecrets & { DRAFT_QUEUE?: Queue };
interface DraftJob { order_id: string; external_id: string; status: string; payload_json: string | null; attempts: number; }
interface DraftPayload { external_id: string; shipping: 'STANDARD'; recipient: ShippingAddress; items: { sync_variant_id: number; quantity: number; retail_price: string; name: string }[]; packing_slip: { message: string }; }
class DraftError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, retryable = false) { super(code); this.code = code; this.retryable = retryable; }
}
// The transport has no confirmation/update route. Never follow provider redirects.
export async function draftApi(token: string, path: string, payload?: DraftPayload, fetcher: typeof fetch = fetch) {
  const creating = path === '/orders?confirm=false&update_existing=false';
  if ((!creating && !/^\/(orders\/@[a-f0-9]{32}|store\/variants\/\d+)$/.test(path)) || creating !== !!payload)
    throw new DraftError('unsupported_operation');
  let response;
  try {
    response = await fetcher.call(globalThis, 'https://api.printful.com' + path, {
      method: creating ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, 'X-PF-Store-Id': String(printfulStoreId), 'Content-Type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
  } catch { throw new DraftError('printful_network', true); }
  if (response.status === 404 && path.startsWith('/orders/@')) return null;
  if (!response.ok) throw new DraftError(`printful_http_${response.status}`, response.status === 429 || response.status >= 500 || response.status === 409);
  try {
    const data = JSON.parse(await boundedText(response, 262144));
    if (data.code !== 200 || !data.result) throw new Error();
    return data.result;
  } catch { throw new DraftError('printful_invalid_response', true); }
}
function payloadFor(order: PaymentOrder, reference: string): DraftPayload {
  try {
    const address = shippingAddress(JSON.parse(order.shipping_address_json || 'null'));
    const lines: PaymentLine[] = JSON.parse(order.lines_json);
    if (order.currency !== 'USD' || !Array.isArray(lines) || lines.length < 1 || lines.length > 3 || new Set(lines.map(l => l.id)).size !== lines.length
        || lines.some(l => !mugMappings[l.id] || l.original || !Number.isInteger(l.quantity) || l.quantity < 1 || !Number.isSafeInteger(l.unitAmount) || l.unitAmount <= 0)
        || lines.reduce((sum,l) => sum + l.quantity, 0) > 25
        || lines.reduce((sum,l) => sum + l.quantity * l.unitAmount, 0) + (order.shipping_cents ?? 0) !== order.amount_cents)
      throw new Error();
    return { external_id: reference, shipping: 'STANDARD', recipient: address,
      items: lines.map(l => ({ sync_variant_id: mugMappings[l.id].syncVariantId, quantity: l.quantity, retail_price: (l.unitAmount / 100).toFixed(2), name: l.name + ' (SANDBOX DRAFT - DO NOT FULFILL)' })),
      packing_slip: { message: 'SANDBOX TEST ONLY - DO NOT CONFIRM OR FULFILL. No real customer payment was taken.' } };
  } catch { throw new DraftError('unsupported_order_snapshot'); }
}
function validateDraft(result: any, payload: DraftPayload): number {
  const normalize = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : '';
  const expected = [...payload.items].sort((a,b) => a.sync_variant_id-b.sync_variant_id);
  const actual = Array.isArray(result?.items) ? [...result.items].sort((a,b) => a.sync_variant_id-b.sync_variant_id) : [];
  if (!Number.isSafeInteger(result?.id) || result.id <= 0 || result.status !== 'draft' || result.external_id !== payload.external_id
      || result.shipping !== payload.shipping || actual.length !== expected.length
      || actual.some((item,i) => item.sync_variant_id !== expected[i].sync_variant_id || item.quantity !== expected[i].quantity)
      || Object.entries(payload.recipient).some(([key,value]) => normalize(result.recipient?.[key]) !== normalize(value)))
    throw new DraftError('printful_order_needs_review');
  return result.id;
}
export async function enqueuePrintfulDraft(env: DraftEnvironment, orderId: string) {
  if (env.PAYMENTS_ENABLED !== 'test' || env.PRINTFUL_DRAFT_MODE !== 'draft-only') return;
  const eligible = await env.PAYMENTS_DB.prepare(`SELECT o.id FROM payment_orders o JOIN payment_test_outbox x ON x.order_id=o.id
    LEFT JOIN payment_printful_drafts j ON j.order_id=o.id WHERE o.id=? AND o.status='Paid' AND o.shipping_address_json IS NOT NULL
    AND x.event_type='BetaPaymentRecorded' AND (j.status IS NULL OR j.status NOT IN ('Draft','Review'))`).bind(orderId).first();
  if (!eligible) return;
  if (!env.DRAFT_QUEUE) throw new Error('Draft queue is not configured');
  // Await publication before acknowledging payment webhooks. Retries can safely publish again.
  await env.DRAFT_QUEUE.send({orderId});
}
export async function consumePrintfulDrafts(batch: MessageBatch<unknown>, env: DraftEnvironment, fetcher: typeof fetch = fetch) {
  if (env.PAYMENTS_ENABLED === 'test' && env.PRINTFUL_DRAFT_MODE === 'draft-only' && !env.PRINTFUL_API_TOKEN)
    throw new Error('Printful token is not configured');
  for (const message of batch.messages) {
    const id = (message.body as {orderId?:unknown})?.orderId;
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) { message.ack(); continue; }
    await processPrintfulDrafts(env,fetcher,undefined,id);
    const job = await env.PAYMENTS_DB.prepare('SELECT status,next_attempt_at,lease_until FROM payment_printful_drafts WHERE order_id=?').bind(id).first<{status:string;next_attempt_at:number;lease_until:number}>();
    if (job && ['Pending','Retry','Processing'].includes(job.status)) message.retry({delaySeconds: Math.max(60,Math.min(3600,Math.max(job.next_attempt_at,job.lease_until)-Math.floor(Date.now()/1000)))});
    else message.ack();
  }
}
export async function processPrintfulDrafts(env: DraftEnvironment, fetcher: typeof fetch = fetch, clock = () => Math.floor(Date.now()/1000), targetId?: string) {
  if (env.PAYMENTS_ENABLED !== 'test' || env.PRINTFUL_DRAFT_MODE !== 'draft-only' || !env.PRINTFUL_API_TOKEN) return;
  const db = env.PAYMENTS_DB, time = clock();
  // Outbox and Paid status are both required. Browser redirects and unpaid orders cannot enqueue drafts.
  await db.prepare(`INSERT OR IGNORE INTO payment_printful_drafts (order_id,external_id,created_at,updated_at)
    SELECT o.id,replace(o.id,'-',''),?,? FROM payment_orders o JOIN payment_test_outbox x ON x.order_id=o.id
    WHERE o.status='Paid' AND o.shipping_address_json IS NOT NULL AND x.event_type='BetaPaymentRecorded' AND (? IS NULL OR o.id=?)`)
    .bind(time,time,targetId??null,targetId??null).run();
  const candidates = await db.prepare("SELECT order_id FROM payment_printful_drafts WHERE status IN ('Pending','Retry','Processing') AND next_attempt_at<=? AND lease_until<=? AND (? IS NULL OR order_id=?) ORDER BY created_at,order_id LIMIT 2")
    .bind(time,time,targetId??null,targetId??null).all<{order_id:string}>();
  for (const candidate of candidates.results) {
    const lease = crypto.randomUUID();
    const job = await db.prepare("UPDATE payment_printful_drafts SET status='Processing',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE order_id=? AND status IN ('Pending','Retry','Processing') AND lease_until<=? AND next_attempt_at<=? RETURNING *")
      .bind(lease,clock()+180,clock(),candidate.order_id,clock(),clock()).first<DraftJob>();
    if (!job) continue;
    try {
      const order = await db.prepare("SELECT o.* FROM payment_orders o JOIN payment_test_outbox x ON x.order_id=o.id WHERE o.id=? AND o.status='Paid' AND x.event_type='BetaPaymentRecorded'").bind(job.order_id).first<PaymentOrder>();
      if (!order) throw new DraftError('payment_not_paid');
      const expected = payloadFor(order,job.external_id);
      const payload: DraftPayload = job.payload_json ? JSON.parse(job.payload_json) : expected;
      if (JSON.stringify(payload) !== JSON.stringify(expected)) throw new DraftError('snapshot_changed');
      if (!job.payload_json) await db.prepare('UPDATE payment_printful_drafts SET payload_json=? WHERE order_id=? AND lease_token=?').bind(JSON.stringify(payload),job.order_id,lease).run();
      let result = await draftApi(env.PRINTFUL_API_TOKEN, '/orders/@'+job.external_id, undefined, fetcher);
      if (!result) {
        if (job.attempts > 5) throw new DraftError('retry_limit');
        for (const item of payload.items) {
          const detail = await draftApi(env.PRINTFUL_API_TOKEN, '/store/variants/'+item.sync_variant_id, undefined, fetcher);
          const variant = detail, mapping = Object.values(mugMappings).find(m => m.syncVariantId === item.sync_variant_id);
          const files = variant?.files?.filter((file: {type?:string}) => file.type !== 'preview');
          if (variant?.sync_product_id !== 474191924 || variant?.id !== item.sync_variant_id || variant.variant_id !== mapping?.catalogVariantId
              || !variant.synced || variant.is_ignored || !files?.length || files.some((file: {status?:string}) => file.status !== 'ok'))
            throw new DraftError('variant_or_print_file_not_ready');
        }
        // A stale lease must never start another submission. External ID uniqueness also protects ambiguous retries.
        const active = await db.prepare("SELECT j.order_id FROM payment_printful_drafts j JOIN payment_orders o ON o.id=j.order_id WHERE j.order_id=? AND j.lease_token=? AND j.lease_until>? AND o.status='Paid'").bind(job.order_id,lease,clock()).first();
        if (!active) continue;
        try { result = await draftApi(env.PRINTFUL_API_TOKEN, '/orders?confirm=false&update_existing=false', payload, fetcher); }
        catch (error) {
          // Recover an accepted order after a lost response; never use a new external ID.
          try { result = await draftApi(env.PRINTFUL_API_TOKEN, '/orders/@'+job.external_id, undefined, fetcher); } catch { throw error; }
          if (!result) throw error;
        }
      }
      const printfulId = validateDraft(result,payload);
      await db.prepare("UPDATE payment_printful_drafts SET status='Draft',printful_id=?,lease_token=NULL,lease_until=0,last_error=NULL,updated_at=? WHERE order_id=? AND lease_token=?")
        .bind(printfulId,clock(),job.order_id,lease).run();
      console.log(JSON.stringify({event:'printful_draft_ready',orderId:job.order_id,printfulId}));
    } catch (error) {
      const code = error instanceof DraftError ? error.code : 'draft_internal_error';
      const retry = (!(error instanceof DraftError) || error.retryable) && job.attempts < 5;
      await db.prepare('UPDATE payment_printful_drafts SET status=?,last_error=?,next_attempt_at=?,lease_token=NULL,lease_until=0,updated_at=? WHERE order_id=? AND lease_token=?')
        .bind(retry?'Retry':'Review',code,clock()+Math.min(3600,60*2**Math.min(job.attempts,6)),clock(),job.order_id,lease).run();
      console.error(JSON.stringify({event:'printful_draft_failed',orderId:job.order_id,code,retry}));
    }
  }
}
