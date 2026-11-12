import type { ProductCandidate } from './commerce.js';
import type { ObjectDescription } from './types.js';
import { brandsCompatible } from './brand-gate.js';
import { isGroupVariantId, videoLocalIdBelongsTo } from './roster-outline.js';

export type VerifiedProductProvenance = 'creator_verified' | 'brand_verified' | 'admin_verified' | 'test_fixture';

export type VpmTrustedObservation = {
  observed_at: string;
  timestamp_ms?: number | null;
  reason: 'promotion' | 'model_exact' | 'distinctive_text_exact' | 'visual_confirmed';
  confidence: number;
  visible_text: string[];
  logos_markings: string[];
  distinctive_features: string[];
  shape_silhouette: string[];
  style_attributes: string[];
  color?: string | null;
  material?: string | null;
};

export type VerifiedProductMapping = {
  platform: string;
  content_ref: string;
  scope: 'entire_video' | 'time_window';
  timestamp_start_ms?: number;
  timestamp_end_ms?: number;
  /** Optional candidate-only appearance window for partner rosters. Unlike scope=time_window,
   * this narrows which identities are visually compared without asserting identity by time. */
  candidate_window_start_ms?: number;
  candidate_window_end_ms?: number;
  object_type: string;
  brand: string;
  product_id: string;
  variant_id?: string | null;
  family?: string | null;
  title: string;
  destination: string;
  image_reference?: string | null;
  /**
   * Extra catalog images of this same variant on other hosts. Visual evidence
   * only: they never become merchant offers and never establish Exact by
   * themselves. They let the verifier still compare pixels when one image host
   * blocks or times out.
   */
  reference_images?: string[] | null;
  /**
   * Set when a roster candidate is creator-verified but no loadable same-variant
   * reference image exists yet. The row stays visible as a candidate, but it
   * carries no pixels, so the verifier cannot compare it and it must never be
   * returned as Exact from text evidence alone. The roster image check reports
   * these rows explicitly instead of silently skipping them.
   */
  reference_image_status?: 'pending_partner_image' | null;
  /**
   * 'video_local': a candidate identity that exists only for this content. It is
   * a variant the partner named and listed without any manufacturer code, so
   * `product_id` / `variant_id` hold a roster handle (VR-<video>-...), never a
   * manufacturer SKU. Such a row is never resolved from text, never searched or
   * shown as a model number, never reused in another video, and still has to
   * win the same-video visual verifier like any other roster candidate.
   */
  identity_scope?: 'video_local' | null;
  /**
   * product_ids of earlier roster rows for this same content that this row
   * replaces. The named rows stop being active candidates while this row is
   * active; they are not deleted, so the lineage stays readable and removing
   * this row brings them back.
   */
  supersedes?: string[] | null;
  price?: string | null;
  currency?: string | null;
  provider?: string | null;
  canonical_key?: string | null;
  // A promoted product becomes a persistent identity track for this video.
  // Track membership is resolved from canonical visual/text evidence, not time alone.
  track_id?: string | null;
  trusted_observations?: VpmTrustedObservation[];
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
    // A video-local handle must be declared as one and must belong to this
    // content. Anything else is dropped rather than read as a manufacturer SKU.
    const handle = [record.product_id, record.variant_id].find((value) => typeof value === 'string' && isGroupVariantId(value)) as string | undefined;
    const videoLocal = record.identity_scope === 'video_local';
    if (Boolean(handle) !== videoLocal) return [];
    if (videoLocal && !videoLocalIdBelongsTo(handle, record.content_ref as string)) return [];
    return [{
      platform: (record.platform as string).trim(),
      content_ref: (record.content_ref as string).trim(),
      scope: record.scope,
      ...(start !== undefined ? { timestamp_start_ms: start } : {}),
      ...(end !== undefined ? { timestamp_end_ms: end } : {}),
      ...(typeof record.candidate_window_start_ms === 'number' && Number.isFinite(record.candidate_window_start_ms) && record.candidate_window_start_ms >= 0
        ? { candidate_window_start_ms: record.candidate_window_start_ms } : {}),
      ...(typeof record.candidate_window_end_ms === 'number' && Number.isFinite(record.candidate_window_end_ms) && record.candidate_window_end_ms >= 0
        ? { candidate_window_end_ms: record.candidate_window_end_ms } : {}),
      object_type: (record.object_type as string).trim(),
      brand: (record.brand as string).trim(),
      product_id: (record.product_id as string).trim(),
      ...(typeof record.variant_id === 'string' && record.variant_id.trim() ? { variant_id: record.variant_id.trim().slice(0, 160) } : {}),
      ...(typeof record.family === 'string' && record.family.trim() ? { family: record.family.trim().slice(0, 160) } : {}),
      title: (record.title as string).trim(),
      destination: (record.destination as string).trim(),
      image_reference: typeof record.image_reference === 'string' && record.image_reference.trim() ? record.image_reference.trim() : null,
      ...(Array.isArray(record.reference_images)
        ? { reference_images: (record.reference_images as unknown[])
          .filter((url): url is string => typeof url === 'string' && /^https:\/\//i.test(url.trim()))
          .map(url => url.trim().slice(0, 1200))
          .slice(0, 6) }
        : {}),
      ...(record.reference_image_status === 'pending_partner_image'
        ? { reference_image_status: 'pending_partner_image' as const }
        : {}),
      ...(videoLocal ? { identity_scope: 'video_local' as const } : {}),
      ...(Array.isArray(record.supersedes)
        ? { supersedes: (record.supersedes as unknown[]).filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map(id => id.trim().slice(0, 160)).slice(0, 20) }
        : {}),
      price: typeof record.price === 'string' && record.price.trim() ? record.price.trim() : null,
      currency: typeof record.currency === 'string' && record.currency.trim() ? record.currency.trim().toUpperCase().slice(0, 8) : null,
      provider: typeof record.provider === 'string' && record.provider.trim() ? record.provider.trim() : null,
      ...(typeof record.canonical_key === 'string' && record.canonical_key.trim()
        ? { canonical_key: record.canonical_key.trim().slice(0, 220) }
        : {}),
      ...(typeof record.track_id === 'string' && record.track_id.trim()
        ? { track_id: record.track_id.trim().slice(0, 220) }
        : {}),
      provenance,
    }];
  });
}


function directSkuEvidence(description: ObjectDescription, productId: string): boolean {
  const sku = normalize(productId);
  if (!sku) return false;
  const groundedContext = (description.evidence_confidence?.contextual_text ?? 0) >= 0.8
    ? (description.contextual_text ?? [])
    : [];
  const evidence = normalize([
    description.model_candidate,
    ...description.visible_text,
    ...groundedContext,
  ].filter(Boolean).join(' '));
  return Boolean(evidence && evidence.includes(sku));
}

const GENERIC_IDENTITY_TOKENS = new Set([
  'louis', 'vuitton', 'bag', 'bags', 'handbag', 'handbags', 'canvas', 'monogram',
  'women', 'woman', 'mens', 'men', 'product', 'authentic', 'edition',
]);

function verifiedMappingIdentityScore(mapping: VerifiedProductMapping, description: ObjectDescription): number {
  const evidence = normalize([
    description.model_candidate,
    description.color,
    description.material,
    ...description.visible_text,
    ...((description.evidence_confidence?.contextual_text ?? 0) >= 0.8 ? (description.contextual_text ?? []) : []),
    ...description.logos_markings,
    ...description.distinctive_features,
    ...description.style_attributes,
    ...description.shape_silhouette,
    ...description.search_terms,
  ].filter(Boolean).join(' '));

  if (!evidence) return 0;

  const productId = normalize(mapping.product_id);
  let score = productId && evidence.includes(productId) ? 20 : 0;

  const identityTokens = [...new Set(normalize(mapping.title)
    .split(' ')
    .filter((token) => token.length >= 4 && !GENERIC_IDENTITY_TOKENS.has(token)))];

  for (const token of identityTokens) {
    if (evidence.includes(token)) score += token.length >= 8 ? 3 : 1;
  }

  for (const observation of mapping.trusted_observations ?? []) {
    const observationTokens = [
      observation.color,
      observation.material,
      ...observation.visible_text,
      ...observation.logos_markings,
      ...observation.distinctive_features,
      ...observation.shape_silhouette,
      ...observation.style_attributes,
    ]
      .map((value) => normalize(value))
      .filter(Boolean);
    for (const token of observationTokens) {
      if (token.length >= 4 && evidence.includes(token)) score += 2;
    }
  }

  return score;
}

export function lookupVerifiedProductMapping(input: LookupInput): VerifiedProductMapping | null {
  if (!input.platform || !input.contentRef) return null;
  const platform = normalize(input.platform);
  const contentRef = normalizeContentRef(input.platform, input.contentRef);
  const mappings = [...parseVerifiedProductMappings(input.rawRegistry), ...(input.mappings ?? [])];
  // Pending status is a property of the SKU, not of one storage row. If any
  // roster row marks a SKU pending, a stale durable mapping for the same SKU
  // must not resolve it either.
  const pendingSkus = new Set(mappings
    .filter((mapping) => mapping.reference_image_status === 'pending_partner_image')
    .map((mapping) => normalize(mapping.product_id)));
  const matches = mappings.filter((mapping) => {
    if (mapping.provenance === 'test_fixture' && !input.allowTestFixtures) return false;
    // A roster candidate without loadable same-variant pixels cannot be visually
    // verified. Never let text evidence promote it to Exact.
    if (mapping.reference_image_status === 'pending_partner_image') return false;
    if (pendingSkus.has(normalize(mapping.product_id))) return false;
    // A video-local handle is not a product anyone can name. Text can never
    // resolve it; only the same-video visual verifier can.
    if (mapping.identity_scope === 'video_local' || isGroupVariantId(mapping.product_id)) return false;
    const timestampMatches = mapping.scope === 'entire_video'
      || (typeof input.timestampMs === 'number'
        && typeof mapping.timestamp_start_ms === 'number'
        && typeof mapping.timestamp_end_ms === 'number'
        && input.timestampMs >= mapping.timestamp_start_ms
        && input.timestampMs <= mapping.timestamp_end_ms);
    const brandCompatible = brandsCompatible(mapping.brand, input.description.brand_candidate);

    return normalize(mapping.platform) === platform
      && normalizeContentRef(mapping.platform, mapping.content_ref) === contentRef
      && timestampMatches
      && objectCompatible(mapping.object_type, input.description)
      && brandCompatible;
  });
  if (!matches.length) return null;

  let primary = matches[0];
  const identities = [...new Set(matches.map((mapping) => normalize(mapping.product_id)))];
  if (identities.length > 1) {
    // A multi-product video/partner catalog must never turn a family-level guess
    // (for example "Speedy") into an Exact SKU merely because only one seeded
    // product shares that family name. Direct Exact is allowed only when the
    // SKU itself is explicitly grounded in the current evidence. Otherwise the
    // catalog remains retrieval context and normal search/visual verification
    // stays authoritative.
    const directSkuMatches = matches.filter((mapping) => directSkuEvidence(input.description, mapping.product_id));
    const directSkuIdentities = [...new Set(directSkuMatches.map((mapping) => normalize(mapping.product_id)))];
    if (directSkuIdentities.length !== 1) return null;
    primary = directSkuMatches.find((mapping) => normalize(mapping.product_id) === directSkuIdentities[0]) ?? directSkuMatches[0];
  }

  // The same verified SKU may exist in both durable storage and a seed/registry
  // during migration. Keep the first mapping as authority, but fill missing
  // non-identity metadata from equivalent records so image/provider data does
  // not randomly disappear depending on which path resolved first.
  const identity = normalize(primary.product_id);
  return matches
    .filter((mapping) => normalize(mapping.product_id) === identity)
    .reduce<VerifiedProductMapping>((merged, mapping) => ({
      ...merged,
      image_reference: merged.image_reference ?? mapping.image_reference ?? null,
      price: merged.price ?? mapping.price ?? null,
      currency: merged.currency ?? mapping.currency ?? null,
      provider: merged.provider ?? mapping.provider ?? null,
      canonical_key: merged.canonical_key ?? mapping.canonical_key ?? null,
      track_id: merged.track_id ?? mapping.track_id ?? null,
      reference_image_status: merged.reference_image_status ?? mapping.reference_image_status ?? null,
      ...(merged.reference_images?.length || mapping.reference_images?.length
        ? { reference_images: merged.reference_images?.length ? merged.reference_images : mapping.reference_images }
        : {}),
      trusted_observations: merged.trusted_observations?.length
        ? merged.trusted_observations
        : mapping.trusted_observations,
    }), primary);
}

export function verifiedMappingProduct(mapping: VerifiedProductMapping): ProductCandidate {
  if (mapping.identity_scope === 'video_local') {
    // No model number, no "verified SKU" wording: this is the partner's own
    // variant for this video, matched by pixels.
    return {
      id: `video-local:${mapping.platform}:${mapping.content_ref}:${mapping.product_id}`,
      title: mapping.title,
      brand: mapping.brand,
      model: null,
      category: mapping.object_type,
      image_reference: mapping.image_reference ?? null,
      provenance: mapping.provenance,
      destination: mapping.destination,
      price: mapping.price ?? null,
      currency: mapping.currency ?? null,
      result_class: 'EXACT',
      relationship: 'EXACT',
      metadata: { brand: mapping.brand, category: mapping.object_type },
      verification_status: 'metadata_only',
      verification_score: 100,
      verification_reasons: ['partner-listed variant for this video; no manufacturer SKU on record'],
      ...(mapping.provider ? { provider: mapping.provider } : {}),
      identity_key: `video-local:${mapping.product_id}`,
    };
  }
  return {
    id: `verified:${mapping.platform}:${mapping.content_ref}:${mapping.product_id}`,
    title: mapping.title,
    brand: mapping.brand,
    model: mapping.product_id,
    category: mapping.object_type,
    image_reference: mapping.image_reference ?? null,
    provenance: mapping.provenance,
    destination: mapping.destination,
    price: mapping.price ?? null,
    currency: mapping.currency ?? null,
    result_class: 'EXACT',
    relationship: 'EXACT',
    metadata: { brand: mapping.brand, model: mapping.product_id, category: mapping.object_type },
    verification_status: 'metadata_only',
    verification_score: 100,
    verification_reasons: [`${mapping.provenance} product mapping for this content`],
    ...(mapping.provider ? { provider: mapping.provider } : {}),
    identity_key: `verified:${mapping.product_id}`,
  };
}
