import { canonicalProductIdentity, mergeCanonicalProductIdentity, normalizeIdentityText, type CanonicalProductIdentity } from './canonical-product-memory.js';
import { fetchCatalogImage, parseSourceImage, safeImageUrl, type CatalogImage } from './candidate-images.js';
import { fetchPartnerCatalogMetadata, type PartnerCatalogMetadata } from './partner-catalog.js';
import { persistAdminVerifiedMapping, persistCanonicalProductIdentity, verifiedLedgerRequest, type VerifiedProductLedgerEnv } from './verified-product-ledger.js';
import { resolveSameVideoReuse, type SameVideoCanonicalCandidate } from './same-video-verified-reuse.js';
import type { VerifiedProductMapping } from './verified-product-mapping.js';
import type { ObjectDescription } from './types.js';
import type { ImageComparison } from './verification-evidence.js';

export type RosterOfferInput = {
  destination: string;
  sku?: string;
  variant_id?: string;
  family?: string;
  title?: string;
  brand?: string;
  object_type?: string;
  model?: string;
  color?: string;
  material?: string;
  image_reference?: string;
  merchant_item_id?: string;
  candidate_window_start_ms?: number;
  candidate_window_end_ms?: number;
};
export type LearningFixture = {
  id: string;
  scenario: 'reviewed_correction';
  timestamp_ms: number;
  candidates: SameVideoCanonicalCandidate[];
  description: ObjectDescription;
  comparisons: Record<string, ImageComparison>;
  expected_class: string;
  truth: 'IN_ROSTER';
};
export type CorrectionBundle = {
  promotion_id: string;
  event_id: string;
  result_id: string;
  action: 'verify_product' | 'hard_negative';
  reviewed_by: string;
  created_at: string;
  positive_observation: { crop_asset: string; canonical_key: string; provenance: 'admin_verified' };
  hard_negatives: string[];
  canonical_product: CanonicalProductIdentity;
  regression_case: LearningFixture;
  appearance: { platform: string; content_ref: string; timestamp_ms: number; track_id: string; nearby_crop_assets: string[] };
  metrics: { promoted_corrections: 1; newly_learned_identities: number; hard_negatives: number; repeat_failure_prevented: boolean };
};

export async function assetDigest(image: CatalogImage): Promise<string> {
  // Content address the decoded bytes; alternative base64 spellings cannot mint identities.
  const binary = atob(image.data);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function cacheLearningImage(env: VerifiedProductLedgerEnv, image: CatalogImage, kind: 'catalog' | 'observation'): Promise<string> {
  const key = await assetDigest(image);
  await verifiedLedgerRequest(env, '/learning/asset-put', { key, image, kind });
  return key;
}
export async function learningImage(env: VerifiedProductLedgerEnv, key: string, publicOnly = false): Promise<CatalogImage | null> {
  return (await verifiedLedgerRequest<{ image: CatalogImage | null }>(env, '/learning/asset-get', { key, public_only: publicOnly }))?.image ?? null;
}

/** Fail the entire validation pass on missing SKU/reference; never silently compress or drop a link. */
export async function preparePartnerRoster(
  env: VerifiedProductLedgerEnv,
  origin: string,
  input: { platform: string; content_ref: string; offers: Array<RosterOfferInput | string> },
  dependencies: { metadata: (url: string) => Promise<PartnerCatalogMetadata>; image: typeof fetchCatalogImage }
    = { metadata: fetchPartnerCatalogMetadata, image: fetchCatalogImage },
): Promise<SameVideoCanonicalCandidate[]> {
  if (!env.VERIFIED_PRODUCT_LEDGER) throw new Error('Durable product memory is required');
  if (!input.platform?.trim() || !input.content_ref?.trim() || !Array.isArray(input.offers) || !input.offers.length || input.offers.length > 100) throw new Error('Need source context and 1-100 offers');
  const groups = new Map<string, SameVideoCanonicalCandidate>();
  // Validate and hydrate all rows before publishing any roster membership.
  for (const [index, value] of input.offers.entries()) {
    const offer = typeof value === 'string' ? { destination: value } : value;
    if (!offer || typeof offer !== 'object') throw new Error(`Offer ${index + 1}: invalid offer`);
    if (!safeImageUrl(offer.destination)) throw new Error(`Offer ${index + 1}: invalid public HTTPS destination`);
    const explicit = Boolean((offer.variant_id || offer.sku) && offer.brand && offer.title && offer.object_type && offer.image_reference);
    const metadata = explicit ? {} as PartnerCatalogMetadata : await dependencies.metadata(offer.destination);
    const variant = (offer.variant_id || offer.sku || metadata.variant_id || metadata.sku || '').trim();
    const brand = (offer.brand || metadata.brand || '').trim();
    const title = (offer.title || metadata.title || '').trim();
    const objectType = (offer.object_type || metadata.object_type || '').trim();
    const imageUrl = offer.image_reference || metadata.image_reference;
    if (metadata.resolution === 'ambiguous') throw new Error(`Offer ${index + 1}: linked variant is ambiguous; provide its catalog fields and reference`);
    if (!variant || variant.length > 160 || !brand || !title || !objectType) throw new Error(`Offer ${index + 1}: explicit variant/SKU, brand, title and object type required when catalog metadata is incomplete`);
    const requestedVariant = offer.sku || offer.variant_id;
    if (!offer.image_reference && requestedVariant && metadata.sku && ![metadata.sku, metadata.variant_id].includes(requestedVariant.trim())) throw new Error(`Offer ${index + 1}: reference belongs to a different SKU`);
    if (!imageUrl) throw new Error(`Offer ${index + 1}: reference image missing`);
    const image = await dependencies.image(imageUrl);
    if (!image) throw new Error(`Offer ${index + 1}: reference image unavailable`);
    const asset = await cacheLearningImage(env, image, 'catalog');
    const reference = `${origin}/product-reference/${asset}`;
    const start = offer.candidate_window_start_ms;
    const end = offer.candidate_window_end_ms;
    if ((start != null || end != null) && !(Number.isFinite(start) && Number.isFinite(end) && start! >= 0 && end! >= start!)) throw new Error(`Offer ${index + 1}: invalid candidate window`);
    const mapping: VerifiedProductMapping = {
      platform: input.platform.trim(), content_ref: input.content_ref.trim(), scope: 'entire_video',
      object_type: objectType, brand, product_id: offer.sku || metadata.sku || variant, variant_id: variant,
      family: offer.family?.trim() || metadata.family || offer.model?.trim() || null,
      title, destination: offer.destination, image_reference: reference,
      provider: new URL(offer.destination).hostname, provenance: 'admin_verified',
      ...(start != null ? { candidate_window_start_ms: start, candidate_window_end_ms: end } : {}),
    };
    const identity = canonicalProductIdentity({ mapping, model: offer.model || metadata.model || null,
      merchantItemId: offer.merchant_item_id || null, color: offer.color || metadata.color || null, material: offer.material || metadata.material || null });
    // Canonical keys include the explicit variant, while each merchant URL remains an offer.
    const existing = groups.get(identity.canonical_key);
    if (existing && (existing.mapping.candidate_window_start_ms !== start || existing.mapping.candidate_window_end_ms !== end)) {
      // Multiple appearances must not be compressed into one narrower window.
      existing.mapping = { ...existing.mapping, candidate_window_start_ms: undefined, candidate_window_end_ms: undefined };
    }
    groups.set(identity.canonical_key, { mapping: existing?.mapping ?? mapping,
      identity: existing ? mergeCanonicalProductIdentity(existing.identity, identity) : identity });
  }
  return [...groups.values()].map(row => ({ ...row, mapping: { ...row.mapping, canonical_key: row.identity.canonical_key, track_id: row.identity.canonical_key } }));
}

export async function ingestPartnerRoster(env: VerifiedProductLedgerEnv, rows: SameVideoCanonicalCandidate[]): Promise<void> {
  for (const row of rows) {
    const saved = await persistCanonicalProductIdentity(env, row.identity);
    await persistAdminVerifiedMapping(env, { ...row.mapping, canonical_key: saved.canonical_key, track_id: saved.canonical_key });
  }
}

export function buildCorrectionBundle(input: {
  event_id: string; result_id: string; action: CorrectionBundle['action']; reviewed_by: string;
  crop_asset: string; platform: string; content_ref: string; timestamp_ms: number;
  canonical_product: CanonicalProductIdentity; candidates: SameVideoCanonicalCandidate[];
  description: ObjectDescription; comparisons: Record<string, ImageComparison>;
  before?: LearningFixture; newly_learned: boolean;
}): CorrectionBundle {
  if (!input.event_id || !input.result_id || !input.reviewed_by || !/^[a-f0-9]{64}$/.test(input.crop_asset)
    || !input.platform || !input.content_ref || !Number.isFinite(input.timestamp_ms) || input.timestamp_ms < 0) throw new Error('Correction needs reviewed provenance, crop and exact appearance context');
  const canonical = input.canonical_product;
  if (!canonical.variant_id || !canonical.merchant_refs.length || !canonical.normalized_fingerprint || !canonical.visual_references?.length) throw new Error('Correction needs canonical variant and durable reference');
  const selected = input.candidates.find(row => row.identity.canonical_key === canonical.canonical_key);
  if (!selected) throw new Error('Corrected SKU is absent from the replay roster');
  const family = normalizeIdentityText(canonical.family);
  const siblings = input.candidates.filter(({ identity }) => identity.canonical_key !== canonical.canonical_key
    && normalizeIdentityText(identity.brand) === normalizeIdentityText(canonical.brand)
    && normalizeIdentityText(identity.object_type) === normalizeIdentityText(canonical.object_type)
    && (!family || !identity.family || normalizeIdentityText(identity.family) === family));
  const replay = resolveSameVideoReuse({ description: input.description, candidates: input.candidates, comparisons: new Map(Object.entries(input.comparisons)), require_complete_comparisons: true });
  if (replay.canonical_key !== canonical.canonical_key || !replay.mapping) throw new Error('Correction replay did not pass the production trust gate');
  if (siblings.some(row => !input.comparisons[row.identity.canonical_key])) throw new Error('Missing sibling comparisons; correction remains unlearned');
  const prior = input.before ? resolveSameVideoReuse({ description: input.before.description, candidates: input.before.candidates, comparisons: new Map(Object.entries(input.before.comparisons)) }) : null;
  const id = `correction:${encodeURIComponent(input.event_id)}:${encodeURIComponent(input.result_id)}`;
  return {
    promotion_id: id, event_id: input.event_id, result_id: input.result_id, action: input.action,
    reviewed_by: input.reviewed_by, created_at: new Date().toISOString(),
    positive_observation: { crop_asset: input.crop_asset, canonical_key: canonical.canonical_key, provenance: 'admin_verified' },
    hard_negatives: siblings.map(row => row.identity.canonical_key), canonical_product: canonical,
    regression_case: { id, scenario: 'reviewed_correction', timestamp_ms: input.timestamp_ms,
      candidates: input.candidates, description: input.description, comparisons: input.comparisons,
      expected_class: canonical.canonical_key, truth: 'IN_ROSTER' },
    appearance: { platform: input.platform, content_ref: input.content_ref, timestamp_ms: input.timestamp_ms, track_id: canonical.canonical_key, nearby_crop_assets: [] },
    metrics: { promoted_corrections: 1, newly_learned_identities: input.newly_learned ? 1 : 0,
      hard_negatives: siblings.length, repeat_failure_prevented: Boolean(prior && prior.canonical_key !== canonical.canonical_key) },
  };
}

export async function persistCorrectionBundle(env: VerifiedProductLedgerEnv, bundle: CorrectionBundle): Promise<CorrectionBundle> {
  const result = await verifiedLedgerRequest<{ bundle: CorrectionBundle }>(env, '/learning/commit', bundle);
  if (!result?.bundle) throw new Error('Correction assets were not committed');
  return result.bundle;
}
