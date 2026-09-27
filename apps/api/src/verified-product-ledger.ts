import type { VerifiedProductMapping, VpmTrustedObservation } from './verified-product-mapping.js';
import { canonicalProductIdentity, mergeCanonicalProductIdentity, type CanonicalProductIdentity } from './canonical-product-memory.js';

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

export async function persistTrustedVpmObservation(
  env: VerifiedProductLedgerEnv,
  input: {
    platform: string;
    content_ref: string;
    canonical_key: string;
    observation: VpmTrustedObservation;
  },
): Promise<VerifiedProductMapping | null> {
  const result = await postJson<{ mapping?: VerifiedProductMapping | null }>(env, '/observe', input);
  return result?.mapping ?? null;
}

export async function revokeAdminVerifiedMapping(
  env: VerifiedProductLedgerEnv,
  input: { platform: string; content_ref: string; product_id?: string; canonical_key?: string },
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

export async function durableCanonicalProductIdentities(
  env: VerifiedProductLedgerEnv,
): Promise<CanonicalProductIdentity[]> {
  const result = await postJson<{ identities?: CanonicalProductIdentity[] }>(env, '/canonical/list', {});
  return Array.isArray(result?.identities) ? result!.identities! : [];
}

export async function backfillLegacyAdminCanonicalMappings(
  env: VerifiedProductLedgerEnv,
  mappings: VerifiedProductMapping[],
): Promise<VerifiedProductMapping[]> {
  return await Promise.all(mappings.map(async (mapping) => {
    if (mapping.canonical_key || mapping.provenance !== 'admin_verified') return mapping;
    try {
      const canonical = canonicalProductIdentity({
        mapping,
        model: null,
        merchantItemId: mapping.product_id,
        visibleText: [],
      });
      const savedIdentity = await persistCanonicalProductIdentity(env, canonical);
      return await persistAdminVerifiedMapping(env, { ...mapping, canonical_key: savedIdentity.canonical_key });
    } catch {
      return mapping;
    }
  }));
}

function contentKey(platform: string, contentRef: string): string {
  return `content:${bounded(platform, 40).toLowerCase()}:${bounded(contentRef, 180).toLowerCase()}`;
}

function canonicalKey(value: string): string {
  return `canonical:${bounded(value, 220).toLowerCase()}`;
}

const CANONICAL_INDEX_KEY = 'canonical:index:v1';

function boundedList(value: unknown, maxItems = 12): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => bounded(item, 160)).filter(Boolean))].slice(0, maxItems);
}

function normalizeObservation(value: unknown): VpmTrustedObservation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const reason = record.reason;
  if (reason !== 'promotion' && reason !== 'model_exact' && reason !== 'distinctive_text_exact' && reason !== 'visual_confirmed') return null;
  const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
    ? Math.max(0, Math.min(1, record.confidence))
    : 0;
  const observedAt = bounded(record.observed_at, 40);
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) return null;
  const timestamp = typeof record.timestamp_ms === 'number' && Number.isFinite(record.timestamp_ms) && record.timestamp_ms >= 0
    ? Math.round(record.timestamp_ms)
    : null;
  return {
    observed_at: observedAt,
    timestamp_ms: timestamp,
    reason,
    confidence,
    visible_text: boundedList(record.visible_text),
    logos_markings: boundedList(record.logos_markings),
    distinctive_features: boundedList(record.distinctive_features),
    shape_silhouette: boundedList(record.shape_silhouette),
    style_attributes: boundedList(record.style_attributes),
    color: bounded(record.color, 80) || null,
    material: bounded(record.material, 80) || null,
  };
}

function observationKey(observation: VpmTrustedObservation): string {
  const evidence = [
    observation.reason,
    observation.visible_text.join('|'),
    observation.logos_markings.join('|'),
    observation.distinctive_features.join('|'),
    observation.shape_silhouette.join('|'),
    observation.style_attributes.join('|'),
    observation.color ?? '',
    observation.material ?? '',
  ].join('::').toLowerCase();
  const bucket = observation.timestamp_ms == null ? 'none' : Math.floor(observation.timestamp_ms / 5000);
  return `${bucket}:${evidence}`;
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

    if (path === '/canonical/list') {
      const keys = await this.storage.get<string[]>(CANONICAL_INDEX_KEY) ?? [];
      const identities = (await Promise.all(keys.slice(0, 500).map((key) =>
        this.storage.get<CanonicalProductIdentity>(canonicalKey(key)))))
        .filter((identity): identity is CanonicalProductIdentity => Boolean(identity));
      return Response.json({ identities });
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
      const index = await this.storage.get<string[]>(CANONICAL_INDEX_KEY) ?? [];
      if (!index.includes(key)) {
        index.unshift(key);
        await this.storage.put(CANONICAL_INDEX_KEY, index.slice(0, 500));
      }
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
      // One durable row per promoted product track. Re-promoting the same
      // canonical product updates that track; promoting a different product adds
      // another track for the same video instead of overwriting it.
      const trackId = bounded(mapping.track_id ?? mapping.canonical_key, 220);
      const next = current.filter((entry) => {
        const existingTrackId = bounded(entry.track_id ?? entry.canonical_key, 220);
        if (trackId && existingTrackId) return existingTrackId !== trackId;
        return !(
          entry.product_id === mapping.product_id &&
          entry.scope === mapping.scope &&
          entry.timestamp_start_ms === mapping.timestamp_start_ms &&
          entry.timestamp_end_ms === mapping.timestamp_end_ms
        );
      });
      const previous = current.find((entry) => {
        const existingTrackId = bounded(entry.track_id ?? entry.canonical_key, 220);
        return Boolean(trackId && existingTrackId && existingTrackId === trackId);
      });
      const saved = {
        ...mapping,
        ...(previous?.trusted_observations?.length ? { trusted_observations: previous.trusted_observations } : {}),
      };
      next.unshift(saved);
      await this.storage.put(key, next.slice(0, 100));
      return Response.json({ accepted: true, mapping: saved });
    }

    if (path === '/observe') {
      const body = await request.json() as Record<string, unknown>;
      const platform = bounded(body.platform, 40);
      const contentRef = bounded(body.content_ref, 180);
      const canonical = bounded(body.canonical_key, 220);
      const observation = normalizeObservation(body.observation);
      if (!platform || !contentRef || !canonical || !observation) {
        return Response.json({ error: 'Invalid VPM observation' }, { status: 400 });
      }
      const key = contentKey(platform, contentRef);
      const current = await this.storage.get<VerifiedProductMapping[]>(key) ?? [];
      const index = current.findIndex((entry) =>
        bounded(entry.track_id ?? entry.canonical_key, 220) === canonical
        && bounded(entry.canonical_key, 220) === canonical);
      if (index < 0) return Response.json({ mapping: null });

      const mapping = current[index]!;
      const observations = [...(mapping.trusted_observations ?? [])];
      const keyForObservation = observationKey(observation);
      if (!observations.some((entry) => observationKey(entry) === keyForObservation)) observations.push(observation);
      const updated: VerifiedProductMapping = {
        ...mapping,
        trusted_observations: observations
          .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))
          .slice(0, 20),
      };
      current[index] = updated;
      await this.storage.put(key, current);
      return Response.json({ accepted: true, mapping: updated });
    }

    if (path === '/revoke') {
      const body = await request.json() as Record<string, unknown>;
      const platform = bounded(body.platform, 40);
      const contentRef = bounded(body.content_ref, 180);
      const productId = bounded(body.product_id, 160);
      const canonical = bounded(body.canonical_key, 220);
      if (!platform || !contentRef || (!productId && !canonical)) return Response.json({ error: 'Invalid revoke request' }, { status: 400 });
      const key = contentKey(platform, contentRef);
      const current = await this.storage.get<VerifiedProductMapping[]>(key) ?? [];
      const next = current.filter((entry) => {
        if (canonical && bounded(entry.canonical_key ?? entry.track_id, 220) === canonical) return false;
        if (productId && entry.product_id === productId) return false;
        return true;
      });
      if (next.length === current.length) return Response.json({ revoked: false });
      await this.storage.put(key, next);
      return Response.json({ revoked: true });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}
