import type { VerifiedProductMapping } from './verified-product-mapping.js';
import { mergeCanonicalProductIdentity, type CanonicalProductIdentity } from './canonical-product-memory.js';

type DurableObjectStubLike = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
export type VerifiedProductLedgerNamespaceLike = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
};

export type VerifiedProductLedgerEnv = {
  VERIFIED_PRODUCT_LEDGER?: VerifiedProductLedgerNamespaceLike;
};

function bounded(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function ledgerStub(env: VerifiedProductLedgerEnv): DurableObjectStubLike | null {
  if (!env.VERIFIED_PRODUCT_LEDGER) return null;
  return env.VERIFIED_PRODUCT_LEDGER.get(env.VERIFIED_PRODUCT_LEDGER.idFromName('verified-products-v1'));
}

async function postJson<T>(env: VerifiedProductLedgerEnv, path: string, body: unknown): Promise<T | null> {
  const stub = ledgerStub(env);
  if (!stub) return null;
  const response = await stub.fetch(`https://verified-product-ledger${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`verified product ledger ${path} failed: ${response.status}`);
  return await response.json() as T;
}

export async function durableVerifiedMappings(
  env: VerifiedProductLedgerEnv,
  platform: string | null,
  contentRef: string | null,
): Promise<VerifiedProductMapping[]> {
  if (!platform || !contentRef) return [];
  const result = await postJson<{ mappings?: VerifiedProductMapping[] }>(env, '/lookup', { platform, content_ref: contentRef });
  return Array.isArray(result?.mappings) ? result!.mappings! : [];
}

export async function persistAdminVerifiedMapping(
  env: VerifiedProductLedgerEnv,
  mapping: VerifiedProductMapping,
): Promise<VerifiedProductMapping> {
  const result = await postJson<{ mapping?: VerifiedProductMapping }>(env, '/verify', mapping);
  if (!result?.mapping) throw new Error('verified product ledger unavailable');
  return result.mapping;
}

export async function revokeAdminVerifiedMapping(
  env: VerifiedProductLedgerEnv,
  input: { platform: string; content_ref: string; product_id: string },
): Promise<boolean> {
  const result = await postJson<{ revoked?: boolean }>(env, '/revoke', input);
  return Boolean(result?.revoked);
}

export async function persistCanonicalProductIdentity(
  env: VerifiedProductLedgerEnv,
  identity: CanonicalProductIdentity,
): Promise<CanonicalProductIdentity> {
  const result = await postJson<{ identity?: CanonicalProductIdentity }>(env, '/canonical/upsert', identity);
  if (!result?.identity) throw new Error('canonical product ledger unavailable');
  return result.identity;
}

export async function durableCanonicalProductIdentity(
  env: VerifiedProductLedgerEnv,
  canonicalKey: string,
): Promise<CanonicalProductIdentity | null> {
  if (!canonicalKey) return null;
  const result = await postJson<{ identity?: CanonicalProductIdentity | null }>(env, '/canonical/get', { canonical_key: canonicalKey });
  return result?.identity ?? null;
}

function contentKey(platform: string, contentRef: string): string {
  return `content:${bounded(platform, 40).toLowerCase()}:${bounded(contentRef, 180).toLowerCase()}`;
}

function canonicalKey(value: string): string {
  return `canonical:${bounded(value, 220).toLowerCase()}`;
}

export class VerifiedProductLedger {
  private readonly storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put<T = unknown>(key: string, value: T): Promise<void>;
  };

  constructor(ctx: { storage: VerifiedProductLedger['storage'] }) {
    this.storage = ctx.storage;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ error: 'Not found' }, { status: 404 });
    const path = new URL(request.url).pathname;

    if (path === '/lookup') {
      const body = await request.json() as Record<string, unknown>;
      const platform = bounded(body.platform, 40);
      const contentRef = bounded(body.content_ref, 180);
      if (!platform || !contentRef) return Response.json({ mappings: [] });
      return Response.json({ mappings: await this.storage.get<VerifiedProductMapping[]>(contentKey(platform, contentRef)) ?? [] });
    }

    if (path === '/canonical/get') {
      const body = await request.json() as Record<string, unknown>;
      const key = bounded(body.canonical_key, 220);
      if (!key) return Response.json({ identity: null });
      return Response.json({ identity: await this.storage.get<CanonicalProductIdentity>(canonicalKey(key)) ?? null });
    }

    if (path === '/canonical/upsert') {
      const incoming = await request.json() as CanonicalProductIdentity;
      const key = bounded(incoming.canonical_key, 220);
      if (!key || !bounded(incoming.title, 300) || !bounded(incoming.object_type, 100)) {
        return Response.json({ error: 'Invalid canonical product identity' }, { status: 400 });
      }
      const storageKey = canonicalKey(key);
      const existing = await this.storage.get<CanonicalProductIdentity>(storageKey);
      let identity: CanonicalProductIdentity;
      try {
        identity = existing ? mergeCanonicalProductIdentity(existing, incoming) : incoming;
      } catch {
        return Response.json({ error: 'Conflicting canonical product identity' }, { status: 409 });
      }
      await this.storage.put(storageKey, identity);
      return Response.json({ accepted: true, identity });
    }

    if (path === '/verify') {
      const mapping = await request.json() as VerifiedProductMapping;
      const platform = bounded(mapping.platform, 40);
      const contentRef = bounded(mapping.content_ref, 180);
      if (!platform || !contentRef || mapping.provenance !== 'admin_verified') {
        return Response.json({ error: 'Invalid verified mapping' }, { status: 400 });
      }
      const key = contentKey(platform, contentRef);
      const current = await this.storage.get<VerifiedProductMapping[]>(key) ?? [];
      const next = current.filter((entry) => !(
        entry.product_id === mapping.product_id &&
        entry.scope === mapping.scope &&
        entry.timestamp_start_ms === mapping.timestamp_start_ms &&
        entry.timestamp_end_ms === mapping.timestamp_end_ms
      ));
      next.unshift(mapping);
      await this.storage.put(key, next.slice(0, 100));
      return Response.json({ accepted: true, mapping });
    }

    if (path === '/revoke') {
      const body = await request.json() as Record<string, unknown>;
      const platform = bounded(body.platform, 40);
      const contentRef = bounded(body.content_ref, 180);
      const productId = bounded(body.product_id, 160);
      if (!platform || !contentRef || !productId) return Response.json({ error: 'Invalid revoke request' }, { status: 400 });
      const key = contentKey(platform, contentRef);
      const current = await this.storage.get<VerifiedProductMapping[]>(key) ?? [];
      const next = current.filter((entry) => entry.product_id !== productId);
      if (next.length === current.length) return Response.json({ revoked: false });
      await this.storage.put(key, next);
      return Response.json({ revoked: true });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}
