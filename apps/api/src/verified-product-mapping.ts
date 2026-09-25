import type { ProductCandidate } from './commerce.js';
import type { ObjectDescription } from './types.js';

export type VerifiedProductProvenance = 'creator_verified' | 'brand_verified' | 'admin_verified' | 'test_fixture';

export type VerifiedProductMapping = {
  platform: string;
  content_ref: string;
  scope: 'entire_video' | 'time_window';
  timestamp_start_ms?: number;
  timestamp_end_ms?: number;
  object_type: string;
  brand: string;
  product_id: string;
  title: string;
  destination: string;
  image_reference?: string | null;
  provider?: string | null;
  provenance: VerifiedProductProvenance;
};

type LookupInput = {
  rawRegistry?: string;
  allowTestFixtures: boolean;
  platform: string | null;
  contentRef: string | null;
  description: ObjectDescription;
  timestampMs?: number | null;
  mappings?: VerifiedProductMapping[];
};

function normalize(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeContentRef(platform: string, value: string): string {
  const ref = value.trim();
  if (normalize(platform) !== 'youtube') return ref;
  const prefixed = ref.match(/^youtube:(.+)$/i);
  if (prefixed?.[1]) return `youtube:${prefixed[1]}`;
  try {
    const url = new URL(ref);
    const id = url.searchParams.get('v');
    if (id) return `youtube:${id}`;
  } catch {}
  return `youtube:${ref}`;
}

function objectText(description: ObjectDescription): string {
  return normalize([
    description.category,
    description.subcategory,
    ...description.style_attributes,
    ...description.distinctive_features,
    ...description.shape_silhouette,
    ...description.search_terms,
  ].join(' '));
}

function objectCompatible(objectType: string, description: ObjectDescription): boolean {
  const type = normalize(objectType);
  const text = ` ${objectText(description)} `;
  if (!type) return false;
  if (text.includes(` ${type} `)) return true;
  if (type === 'shirt') return ['shirt', 'button down', 'buttondown', 'dress shirt', 'polo', 't shirt', 'tshirt', 'tee'].some((term) => text.includes(` ${term} `));
  return false;
}

export function parseVerifiedProductMappings(rawRegistry?: string): VerifiedProductMapping[] {
  if (!rawRegistry) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(rawRegistry); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((value): VerifiedProductMapping[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const provenance = record.provenance;
    if (provenance !== 'creator_verified' && provenance !== 'brand_verified' && provenance !== 'admin_verified' && provenance !== 'test_fixture') return [];
    const required = ['platform', 'content_ref', 'object_type', 'brand', 'product_id', 'title', 'destination'] as const;
    if (required.some((key) => typeof record[key] !== 'string' || !(record[key] as string).trim())) return [];
    if (record.scope !== 'entire_video' && record.scope !== 'time_window') return [];
    const start = typeof record.timestamp_start_ms === 'number' && Number.isFinite(record.timestamp_start_ms) ? record.timestamp_start_ms : undefined;
    const end = typeof record.timestamp_end_ms === 'number' && Number.isFinite(record.timestamp_end_ms) ? record.timestamp_end_ms : undefined;
    if (record.scope === 'time_window' && (start === undefined || end === undefined || start < 0 || end < start)) return [];
    try { new URL(record.destination as string); } catch { return []; }
    return [{
      platform: (record.platform as string).trim(),
      content_ref: (record.content_ref as string).trim(),
      scope: record.scope,
      ...(start !== undefined ? { timestamp_start_ms: start } : {}),
      ...(end !== undefined ? { timestamp_end_ms: end } : {}),
      object_type: (record.object_type as string).trim(),
      brand: (record.brand as string).trim(),
      product_id: (record.product_id as string).trim(),
      title: (record.title as string).trim(),
      destination: (record.destination as string).trim(),
      image_reference: typeof record.image_reference === 'string' && record.image_reference.trim() ? record.image_reference.trim() : null,
      provider: typeof record.provider === 'string' && record.provider.trim() ? record.provider.trim() : null,
      provenance,
    }];
  });
}

export function lookupVerifiedProductMapping(input: LookupInput): VerifiedProductMapping | null {
  if (!input.platform || !input.contentRef) return null;
  const platform = normalize(input.platform);
  const contentRef = normalizeContentRef(input.platform, input.contentRef);
  const mappings = [...parseVerifiedProductMappings(input.rawRegistry), ...(input.mappings ?? [])];
  return mappings.find((mapping) => {
    if (mapping.provenance === 'test_fixture' && !input.allowTestFixtures) return false;
    const timestampMatches = mapping.scope === 'entire_video'
      || (typeof input.timestampMs === 'number'
        && typeof mapping.timestamp_start_ms === 'number'
        && typeof mapping.timestamp_end_ms === 'number'
        && input.timestampMs >= mapping.timestamp_start_ms
        && input.timestampMs <= mapping.timestamp_end_ms);
    return normalize(mapping.platform) === platform
      && normalizeContentRef(mapping.platform, mapping.content_ref) === contentRef
      && timestampMatches
      && objectCompatible(mapping.object_type, input.description);
  }) ?? null;
}

export function verifiedMappingProduct(mapping: VerifiedProductMapping): ProductCandidate {
  return {
    id: `verified:${mapping.platform}:${mapping.content_ref}:${mapping.product_id}`,
    title: mapping.title,
    brand: mapping.brand,
    model: mapping.product_id,
    category: mapping.object_type,
    image_reference: mapping.image_reference ?? null,
    provenance: mapping.provenance,
    destination: mapping.destination,
    price: null,
    currency: null,
    result_class: 'EXACT',
    metadata: { brand: mapping.brand, model: mapping.product_id, category: mapping.object_type },
    verification_status: 'metadata_only',
    verification_score: 100,
    verification_reasons: [`${mapping.provenance} product mapping for this content`],
    ...(mapping.provider ? { provider: mapping.provider } : {}),
    identity_key: `verified:${mapping.product_id}`,
  };
}
