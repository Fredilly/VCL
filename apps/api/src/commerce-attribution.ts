export type AttributionContext = {
  creator_id: string;
  content_ref: string;
  content_hash: string;
  event_id: string;
  result_id: string;
  merchant: string;
  affiliate_network: string | null;
  click_ref: string;
};

export type CommissionState = 'pending' | 'approved' | 'reversed' | 'paid';

export type CommissionEvent = AttributionContext & {
  transaction_ref: string;
  currency: string;
  gross_commission: number;
  creator_share: number;
  state: CommissionState;
  occurred_at: string;
};

function utf8Bytes(value: string): Uint8Array {
  const encoded = unescape(encodeURIComponent(value));
  return Uint8Array.from(encoded, (char) => char.charCodeAt(0));
}

function utf8Buffer(value: string): ArrayBuffer {
  const bytes = utf8Bytes(value);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function utf8String(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return decodeURIComponent(escape(binary));
}

function safeId(value: unknown, field: string, max = 120): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || !/^[A-Za-z0-9._:|/-]+$/.test(trimmed)) throw new Error(`${field} is invalid`);
  return trimmed;
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', utf8Buffer(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8Buffer(value)));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', utf8Buffer(value));
  return bytesToHex(new Uint8Array(digest));
}

function base64UrlEncode(value: string) {
  const bytes = utf8Bytes(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return utf8String(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function creatorForContent(mapJson: string | undefined, contentRef: unknown): string | null {
  if (!mapJson || typeof contentRef !== 'string' || !contentRef.trim()) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(mapJson); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const creator = (parsed as Record<string, unknown>)[contentRef.trim()];
  if (typeof creator !== 'string') return null;
  try { return safeId(creator, 'creator_id', 80); } catch { return null; }
}

export async function makeCommerceClickRef(input: {
  secret: string;
  creator_id: string;
  content_ref: string;
  event_id: string;
}) {
  const compact = JSON.stringify({
    creator_id: safeId(input.creator_id, 'creator_id', 80),
    content_ref: safeId(input.content_ref, 'content_ref', 180),
    event_id: safeId(input.event_id, 'event_id'),
  });
  return bytesToHex(await hmac(input.secret, compact)).slice(0, 32);
}

export async function makeAttribution(input: {
  secret: string;
  creator_id: string;
  content_ref: string;
  event_id: string;
  result_id: string;
  merchant: string;
  affiliate_network?: string | null;
  click_ref?: string | null;
}) {
  const payload = {
    creator_id: safeId(input.creator_id, 'creator_id', 80),
    content_ref: safeId(input.content_ref, 'content_ref', 180),
    event_id: safeId(input.event_id, 'event_id'),
    result_id: safeId(input.result_id, 'result_id', 180),
    merchant: safeId(input.merchant, 'merchant', 80),
    affiliate_network: input.affiliate_network ? safeId(input.affiliate_network, 'affiliate_network', 80) : null,
  };
  const content_hash = await sha256(payload.content_ref);
  const click_ref = input.click_ref ? safeId(input.click_ref, 'click_ref', 64) : null;
  const compact = JSON.stringify({ ...payload, content_hash, ...(click_ref ? { click_ref } : {}) });
  const signature = bytesToHex(await hmac(input.secret, compact));
  const resolved_click_ref = click_ref ?? signature.slice(0, 32);
  return {
    attribution_token: `${base64UrlEncode(compact)}.${signature}`,
    click_ref: resolved_click_ref,
    content_hash,
  };
}

export async function verifyAttributionToken(secret: string, token: unknown): Promise<AttributionContext> {
  if (typeof token !== 'string' || token.length > 1400) throw new Error('Invalid attribution token');
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) throw new Error('Invalid attribution token');
  const compact = base64UrlDecode(encoded);
  const expected = bytesToHex(await hmac(secret, compact));
  if (signature.length !== expected.length) throw new Error('Invalid attribution token');
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (mismatch !== 0) throw new Error('Invalid attribution token');

  const parsed = JSON.parse(compact) as Record<string, unknown>;
  const creator_id = safeId(parsed.creator_id, 'creator_id', 80);
  const content_ref = safeId(parsed.content_ref, 'content_ref', 180);
  const event_id = safeId(parsed.event_id, 'event_id');
  const result_id = safeId(parsed.result_id, 'result_id', 180);
  const merchant = safeId(parsed.merchant, 'merchant', 80);
  const affiliate_network = parsed.affiliate_network == null ? null : safeId(parsed.affiliate_network, 'affiliate_network', 80);
  const content_hash = safeId(parsed.content_hash, 'content_hash', 64);
  const click_ref = parsed.click_ref == null ? signature.slice(0, 32) : safeId(parsed.click_ref, 'click_ref', 64);
  return { creator_id, content_ref, content_hash, event_id, result_id, merchant, affiliate_network, click_ref };
}

export function recordCommerceClick(context: AttributionContext) {
  console.log(JSON.stringify({
    event: 'ALPHA_COMMERCE_CLICK',
    schema_version: 1,
    creator_id: context.creator_id,
    content_hash: context.content_hash,
    event_id: context.event_id,
    result_id: context.result_id,
    merchant: context.merchant,
    affiliate_network: context.affiliate_network,
    click_ref: context.click_ref,
    occurred_at: new Date().toISOString(),
  }));
}

export function normalizeCommissionEvent(value: unknown): CommissionEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('commission event must be an object');
  const v = value as Record<string, unknown>;
  const state = v.state;
  if (!['pending', 'approved', 'reversed', 'paid'].includes(String(state))) throw new Error('Invalid commission state');
  const gross = Number(v.gross_commission);
  const share = Number(v.creator_share);
  if (!Number.isFinite(gross) || gross < 0 || !Number.isFinite(share) || share < 0 || share > gross) throw new Error('Invalid commission amounts');
  const occurred = typeof v.occurred_at === 'string' && !Number.isNaN(Date.parse(v.occurred_at)) ? v.occurred_at : new Date().toISOString();
  return {
    creator_id: safeId(v.creator_id, 'creator_id', 80),
    content_ref: safeId(v.content_ref, 'content_ref', 180),
    content_hash: safeId(v.content_hash, 'content_hash', 64),
    event_id: safeId(v.event_id, 'event_id'),
    result_id: safeId(v.result_id, 'result_id', 180),
    merchant: safeId(v.merchant, 'merchant', 80),
    affiliate_network: v.affiliate_network == null ? null : safeId(v.affiliate_network, 'affiliate_network', 80),
    click_ref: safeId(v.click_ref, 'click_ref', 64),
    transaction_ref: safeId(v.transaction_ref, 'transaction_ref', 180),
    currency: safeId(v.currency, 'currency', 12).toUpperCase(),
    gross_commission: gross,
    creator_share: share,
    state: state as CommissionState,
    occurred_at: occurred,
  };
}

export function recordCommissionEvent(value: unknown) {
  const event = normalizeCommissionEvent(value);
  console.log(JSON.stringify({ event: 'ALPHA_COMMISSION', schema_version: 1, ...event }));
  return event;
}

export function reconcileCommission(clicks: AttributionContext[], transaction: {
  click_ref: string;
  transaction_ref: string;
  currency: string;
  gross_commission: number;
  creator_share: number;
  state: CommissionState;
  occurred_at?: string;
}) {
  const click = clicks.find((entry) => entry.click_ref === transaction.click_ref);
  if (!click) throw new Error('Unknown click_ref');
  return normalizeCommissionEvent({ ...click, ...transaction, occurred_at: transaction.occurred_at ?? new Date().toISOString() });
}
