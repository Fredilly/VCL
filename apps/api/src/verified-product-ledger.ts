import type { VerifiedProductMapping, VpmTrustedObservation } from './verified-product-mapping.js';
import { canonicalMerchantOfferKey, canonicalProductIdentity, canonicalProductsEquivalent, mergeCanonicalProductIdentity, normalizeIdentityText, type CanonicalProductIdentity } from './canonical-product-memory.js';

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

export async function consolidateCanonicalProducts(
  env: VerifiedProductLedgerEnv,
  canonicalKeys: string[],
): Promise<CanonicalProductIdentity | null> {
  const result = await postJson<{ identity?: CanonicalProductIdentity | null }>(env, '/canonical/consolidate', {
    canonical_keys: canonicalKeys,
  });
  return result?.identity ?? null;
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

export type CanonicalRetrievalPath = 'TEXT' | 'MODEL' | 'STRUCTURED';

export async function durableCanonicalCandidates(
  env: VerifiedProductLedgerEnv,
  input: {
    paths: CanonicalRetrievalPath[];
    brand?: string | null;
    model?: string | null;
    object_type?: string | null;
    color?: string | null;
    visible_text?: string[];
    logos_markings?: string[];
    limit?: number;
  },
): Promise<CanonicalProductIdentity[]> {
  const result = await postJson<{ identities?: CanonicalProductIdentity[] }>(env, '/canonical/search', input);
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
const CANONICAL_EVIDENCE_INDEX_READY = 'canonical:evidence-index:v1';

function evidencePart(value: string | null | undefined): string {
  return normalizeIdentityText(value).replace(/\s+/g, '_').slice(0, 120);
}

function evidenceWords(values: Array<string | null | undefined>): string[] {
  return [...new Set(normalizeIdentityText(values.filter(Boolean).join(' '))
    .split(' ')
    .filter((token) => token.length >= 4))]
    .slice(0, 12);
}

function canonicalIndexRow(prefix: string, canonical: string): string {
  return `canonical-idx:${prefix}:${bounded(canonical, 220).toLowerCase()}`;
}

function canonicalIndexPrefixes(identity: CanonicalProductIdentity): string[] {
  const prefixes: string[] = [];
  const brand = evidencePart(identity.brand);
  const model = evidencePart(identity.model);
  const type = evidencePart(identity.object_type);
  const color = evidencePart(identity.color);

  if (model) prefixes.push(`model:${brand || '_'}:${model}`);
  if (type) {
    prefixes.push(`type:${type}`);
    if (brand) prefixes.push(`type-brand:${type}:${brand}`);
    if (color) prefixes.push(`type-color:${type}:${color}`);
  }
  for (const word of evidenceWords([
    identity.title,
    ...identity.visible_text,
    ...(identity.logos_markings ?? []),
  ])) prefixes.push(`text:${evidencePart(word)}`);
  return [...new Set(prefixes)].slice(0, 32);
}

function offerOwnerKey(offerKey: string): string {
  return `offer-owner:${bounded(offerKey, 420).toLowerCase()}`;
}

function canonicalRedirectKey(canonical: string): string {
  return `canonical-redirect:${bounded(canonical, 220).toLowerCase()}`;
}

function mergeSameOfferIdentity(existing: CanonicalProductIdentity, incoming: CanonicalProductIdentity): CanonicalProductIdentity {
  const merchantRefs = [...existing.merchant_refs];
  for (const ref of incoming.merchant_refs) {
    const offerKey = ref.offer_key || canonicalMerchantOfferKey(ref);
    if (!merchantRefs.some((current) => (current.offer_key || canonicalMerchantOfferKey(current)) === offerKey)) {
      merchantRefs.push({ ...ref, offer_key: offerKey });
    }
  }
  return {
    ...existing,
    visible_text: [...new Set([...existing.visible_text, ...incoming.visible_text])].slice(0, 12),
    style_attributes: [...new Set([...(existing.style_attributes ?? []), ...(incoming.style_attributes ?? [])])].slice(0, 12),
    logos_markings: [...new Set([...(existing.logos_markings ?? []), ...(incoming.logos_markings ?? [])])].slice(0, 8),
    distinctive_features: [...new Set([...(existing.distinctive_features ?? []), ...(incoming.distinctive_features ?? [])])].slice(0, 12),
    shape_silhouette: [...new Set([...(existing.shape_silhouette ?? []), ...(incoming.shape_silhouette ?? [])])].slice(0, 8),
    color: existing.color ?? incoming.color ?? null,
    material: existing.material ?? incoming.material ?? null,
    verified_at: incoming.verified_at,
    merchant_refs: merchantRefs.slice(0, 25),
  };
}

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
    delete?(key: string): Promise<boolean>;
    list?<T = unknown>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>>;
  };
  private canonicalWriteTail: Promise<void> = Promise.resolve();

  private async serializeCanonicalWrite<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.canonicalWriteTail;
    this.canonicalWriteTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); }
    finally { release(); }
  }

  constructor(ctx: { storage: VerifiedProductLedger['storage'] }) {
    this.storage = ctx.storage;
  }

  private async resolveCanonicalKey(key: string): Promise<string> {
    let current = bounded(key, 220);
    const seen = new Set<string>();
    for (let depth = 0; depth < 8 && current; depth += 1) {
      if (seen.has(current)) break;
      seen.add(current);
      const next = await this.storage.get<string>(canonicalRedirectKey(current));
      if (!next || next === current) break;
      current = next;
    }
    return current;
  }

  private async deleteCanonicalIndexRows(identity: CanonicalProductIdentity): Promise<void> {
    if (!this.storage.delete) return;
    for (const prefix of canonicalIndexPrefixes(identity)) {
      await this.storage.delete(canonicalIndexRow(prefix, identity.canonical_key));
    }
  }

  private async indexCanonicalIdentity(identity: CanonicalProductIdentity): Promise<void> {
    for (const prefix of canonicalIndexPrefixes(identity)) {
      await this.storage.put(canonicalIndexRow(prefix, identity.canonical_key), identity.canonical_key);
    }
  }

  private async ensureCanonicalEvidenceIndex(): Promise<void> {
    if (await this.storage.get<boolean>(CANONICAL_EVIDENCE_INDEX_READY)) return;
    // One-time alpha migration. Steady-state retrieval never scans the canonical graph.
    const keys = await this.storage.get<string[]>(CANONICAL_INDEX_KEY) ?? [];
    for (const key of keys.slice(0, 500)) {
      const identity = await this.storage.get<CanonicalProductIdentity>(canonicalKey(key));
      if (identity) await this.indexCanonicalIdentity(identity);
    }
    await this.storage.put(CANONICAL_EVIDENCE_INDEX_READY, true);
  }

  private async canonicalKeysForPrefix(prefix: string, limit: number): Promise<string[]> {
    if (!this.storage.list) return [];
    const rows = await this.storage.list<string>({ prefix: `canonical-idx:${prefix}:`, limit });
    return [...rows.values()].filter((value): value is string => typeof value === 'string');
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ error: 'Not found' }, { status: 404 });
    const path = new URL(request.url).pathname;

    if (path === '/lookup') {
      const body = await request.json() as Record<string, unknown>;
      const platform = bounded(body.platform, 40);
      const contentRef = bounded(body.content_ref, 180);
      if (!platform || !contentRef) return Response.json({ mappings: [] });
      const key = contentKey(platform, contentRef);
      const mappings = await this.storage.get<VerifiedProductMapping[]>(key) ?? [];
      let changed = false;
      const resolved = await Promise.all(mappings.map(async (mapping) => {
        const canonical = bounded(mapping.canonical_key, 220);
        if (!canonical) return mapping;
        const resolvedCanonical = await this.resolveCanonicalKey(canonical);
        if (!resolvedCanonical || resolvedCanonical === canonical) return mapping;
        changed = true;
        return {
          ...mapping,
          canonical_key: resolvedCanonical,
          ...(bounded(mapping.track_id, 220) === canonical ? { track_id: resolvedCanonical } : {}),
        };
      }));
      if (changed) await this.storage.put(key, resolved);
      return Response.json({ mappings: resolved });
    }

    if (path === '/canonical/get') {
      const body = await request.json() as Record<string, unknown>;
      const key = bounded(body.canonical_key, 220);
      if (!key) return Response.json({ identity: null });
      const resolvedKey = await this.resolveCanonicalKey(key);
      return Response.json({ identity: await this.storage.get<CanonicalProductIdentity>(canonicalKey(resolvedKey)) ?? null });
    }

    if (path === '/canonical/by-offer') {
      const body = await request.json() as Record<string, unknown>;
      const offerKey = bounded(body.offer_key, 420).toLowerCase();
      if (!offerKey) return Response.json({ canonical_key: null, identity: null });
      const owner = await this.storage.get<string>(offerOwnerKey(offerKey));
      if (!owner) return Response.json({ canonical_key: null, identity: null });
      const canonical = await this.resolveCanonicalKey(owner);
      return Response.json({
        canonical_key: canonical,
        identity: await this.storage.get<CanonicalProductIdentity>(canonicalKey(canonical)) ?? null,
      });
    }

    if (path === '/canonical/consolidate') {
      const body = await request.json() as Record<string, unknown>;
      const rawKeys = Array.isArray(body.canonical_keys) ? body.canonical_keys : [];
      const requested = [...new Set(rawKeys.map((value) => bounded(value, 220)).filter(Boolean))];
      if (requested.length < 2 || requested.length > 12) {
        return Response.json({ error: 'Need 2-12 canonical keys' }, { status: 400 });
      }

      return await this.serializeCanonicalWrite(async () => {
        const resolvedKeys = [...new Set(await Promise.all(requested.map((key) =>
          this.resolveCanonicalKey(key))))];
        const identities = (await Promise.all(resolvedKeys.map((key) =>
          this.storage.get<CanonicalProductIdentity>(canonicalKey(key)))))
          .filter((identity): identity is CanonicalProductIdentity => Boolean(identity));
        if (identities.length < 2) {
          return Response.json({ identity: identities[0] ?? null, consolidated: false });
        }

        const anchorIdentity = identities[0]!;
        if (!identities.slice(1).every((identity) => canonicalProductsEquivalent(anchorIdentity, identity))) {
          return Response.json({ error: 'Canonical identities are not equivalent' }, { status: 409 });
        }

        const survivorKey = identities.map((identity) => identity.canonical_key).sort()[0]!;
        let survivor = identities.find((identity) => identity.canonical_key === survivorKey)!;
        for (const duplicate of identities) {
          if (duplicate.canonical_key === survivorKey) continue;
          try {
            survivor = mergeCanonicalProductIdentity(survivor, {
              ...duplicate,
              canonical_key: survivorKey,
            });
          } catch {
            return Response.json({ error: 'Conflicting canonical product identity' }, { status: 409 });
          }
        }

        await this.storage.put(canonicalKey(survivorKey), survivor);
        await this.indexCanonicalIdentity(survivor);
        for (const ref of survivor.merchant_refs) {
          const offerKey = ref.offer_key || canonicalMerchantOfferKey(ref);
          await this.storage.put(offerOwnerKey(offerKey), survivorKey);
        }
        for (const duplicate of identities) {
          if (duplicate.canonical_key !== survivorKey) {
            await this.storage.put(canonicalRedirectKey(duplicate.canonical_key), survivorKey);
            await this.deleteCanonicalIndexRows(duplicate);
            if (this.storage.delete) await this.storage.delete(canonicalKey(duplicate.canonical_key));
          }
        }

        const index = await this.storage.get<string[]>(CANONICAL_INDEX_KEY) ?? [];
        const loserKeys = new Set(identities
          .map((identity) => identity.canonical_key)
          .filter((key) => key !== survivorKey));
        const nextIndex = [survivorKey, ...index.filter((key) => key !== survivorKey && !loserKeys.has(key))];
        await this.storage.put(CANONICAL_INDEX_KEY, nextIndex.slice(0, 500));

        return Response.json({
          identity: survivor,
          consolidated: true,
          canonical_key: survivorKey,
          merged_keys: [...loserKeys],
        });
      });
    }

    if (path === '/canonical/search') {
      const body = await request.json() as Record<string, unknown>;
      const rawPaths = Array.isArray(body.paths) ? body.paths : [];
      const paths = new Set(rawPaths.filter((path): path is CanonicalRetrievalPath =>
        path === 'TEXT' || path === 'MODEL' || path === 'STRUCTURED'));
      const limit = typeof body.limit === 'number' && Number.isFinite(body.limit)
        ? Math.max(1, Math.min(24, Math.floor(body.limit)))
        : 12;
      if (!paths.size) return Response.json({ identities: [] });

      await this.ensureCanonicalEvidenceIndex();
      const scores = new Map<string, number>();
      const add = async (prefix: string, weight: number) => {
        for (const key of await this.canonicalKeysForPrefix(prefix, Math.max(limit * 2, 16))) {
          scores.set(key, (scores.get(key) ?? 0) + weight);
        }
      };

      const brand = evidencePart(bounded(body.brand, 120));
      const model = evidencePart(bounded(body.model, 160));
      const objectType = evidencePart(bounded(body.object_type, 100));
      const color = evidencePart(bounded(body.color, 80));

      if (paths.has('MODEL') && model) await add(`model:${brand || '_'}:${model}`, 100);
      if (paths.has('TEXT')) {
        const text = [
          ...boundedList(body.visible_text, 12),
          ...boundedList(body.logos_markings, 8),
        ];
        for (const word of evidenceWords(text).slice(0, 8)) await add(`text:${evidencePart(word)}`, 10);
      }
      if (paths.has('STRUCTURED') && objectType) {
        if (brand) await add(`type-brand:${objectType}:${brand}`, 6);
        if (color) await add(`type-color:${objectType}:${color}`, 4);
        await add(`type:${objectType}`, 1);
      }

      const rankedKeys = [...scores.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([key]) => key);
      const identities: CanonicalProductIdentity[] = [];
      const seen = new Set<string>();
      for (const key of rankedKeys) {
        const resolved = await this.resolveCanonicalKey(key);
        if (seen.has(resolved)) continue;
        const identity = await this.storage.get<CanonicalProductIdentity>(canonicalKey(resolved));
        if (identity) {
          seen.add(resolved);
          identities.push(identity);
        }
      }
      return Response.json({ identities });
    }

    if (path === '/canonical/list') {
      let keys = await this.storage.get<string[]>(CANONICAL_INDEX_KEY) ?? [];
      if (this.storage.list) {
        const legacyRows = await this.storage.list<CanonicalProductIdentity>({ prefix: 'canonical:product:', limit: 500 });
        const legacyKeys = [...legacyRows.keys()].map((storageKey) => storageKey.replace(/^canonical:/, ''));
        const merged = [...new Set([...keys, ...legacyKeys])].slice(0, 500);
        if (merged.length !== keys.length) {
          keys = merged;
          await this.storage.put(CANONICAL_INDEX_KEY, keys);
        }
      }
      const identities = (await Promise.all(keys.slice(0, 500).map((key) =>
        this.storage.get<CanonicalProductIdentity>(canonicalKey(key)))))
        .filter((identity): identity is CanonicalProductIdentity => Boolean(identity));
      return Response.json({ identities });
    }

    if (path === '/canonical/upsert') {
      const incoming = await request.json() as CanonicalProductIdentity;
      const requestedKey = bounded(incoming.canonical_key, 220);
      if (!requestedKey || !bounded(incoming.title, 300) || !bounded(incoming.object_type, 100)) {
        return Response.json({ error: 'Invalid canonical product identity' }, { status: 400 });
      }

      return await this.serializeCanonicalWrite(async () => {
        const refs = incoming.merchant_refs.map((ref) => ({
          ...ref,
          offer_key: ref.offer_key || canonicalMerchantOfferKey(ref),
        }));
        const owners = (await Promise.all(refs.map((ref) =>
          this.storage.get<string>(offerOwnerKey(ref.offer_key!)))))
          .filter((owner): owner is string => Boolean(owner));
        const resolvedOwners = await Promise.all(owners.map((owner) =>
          this.resolveCanonicalKey(owner)));
        const survivorKey = [...new Set(resolvedOwners)].sort()[0] || requestedKey;
        const normalizedIncoming: CanonicalProductIdentity = {
          ...incoming,
          canonical_key: survivorKey,
          merchant_refs: refs,
        };

        const storageKey = canonicalKey(survivorKey);
        const existing = await this.storage.get<CanonicalProductIdentity>(storageKey);
        let identity: CanonicalProductIdentity;
        try {
          identity = existing
            ? mergeCanonicalProductIdentity(existing, normalizedIncoming)
            : normalizedIncoming;
        } catch {
          // Only reconcile conflicting legacy identities when an already-owned
          // merchant offer redirects this write to a different canonical node.
          // Conflicting evidence on the same canonical key must still fail closed.
          if (!existing || survivorKey === requestedKey) {
            return Response.json({ error: 'Conflicting canonical product identity' }, { status: 409 });
          }
          identity = mergeSameOfferIdentity(existing, normalizedIncoming);
        }

        await this.storage.put(storageKey, identity);
        await this.indexCanonicalIdentity(identity);
        await this.storage.put(CANONICAL_EVIDENCE_INDEX_READY, true);
        for (const ref of refs) await this.storage.put(offerOwnerKey(ref.offer_key!), survivorKey);

        if (requestedKey !== survivorKey) {
          await this.storage.put(canonicalRedirectKey(requestedKey), survivorKey);
        }
        for (const owner of resolvedOwners) {
          if (owner !== survivorKey) await this.storage.put(canonicalRedirectKey(owner), survivorKey);
        }

        const index = await this.storage.get<string[]>(CANONICAL_INDEX_KEY) ?? [];
        const nextIndex = [survivorKey, ...index.filter((entry) => entry !== survivorKey && !resolvedOwners.includes(entry) && entry !== requestedKey)];
        await this.storage.put(CANONICAL_INDEX_KEY, nextIndex.slice(0, 500));

        return Response.json({
          accepted: true,
          identity,
          reused_existing_canonical: survivorKey !== requestedKey,
        });
      });
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
