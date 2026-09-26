import type { ProductCandidate, ProductContext } from './commerce.js';
import type { ObjectDescription } from './types.js';
import { canonicalProductIdentity, type CanonicalProductIdentity } from './canonical-product-memory.js';
import type { VerifiedProductMapping } from './verified-product-mapping.js';

export type AutomaticExactMemory = {
  mapping: VerifiedProductMapping;
  identity: CanonicalProductIdentity;
};

function bounded(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Converts an evidence-backed automatic EXACT result into durable video memory.
 * Relationship is the admission gate: SIMILAR/RELATED results are never persisted.
 * The mapping starts with a narrow observation window; same-video reuse outside that
 * window still requires the existing canonical evidence/visual reassociation checks.
 */
export function automaticExactMemory(
  product: ProductCandidate,
  description: ObjectDescription,
  context?: ProductContext,
): AutomaticExactMemory | null {
  if (product.relationship !== 'EXACT') return null;

  const platform = bounded(context?.platform, 40);
  const contentRef = bounded(context?.content_ref, 180);
  const timestampMs = typeof context?.timestamp_ms === 'number' && Number.isFinite(context.timestamp_ms) && context.timestamp_ms >= 0
    ? Math.round(context.timestamp_ms)
    : null;
  const destination = bounded(product.destination, 1200);
  if (!platform || !contentRef || timestampMs === null || !destination) return null;
  try { new URL(destination); } catch { return null; }

  const objectType = bounded(description.subcategory || description.category || product.category, 100);
  const productId = bounded(product.model, 160) || bounded(product.id, 160);
  const title = bounded(product.title, 300);
  if (!objectType || !productId || !title) return null;

  const mapping: VerifiedProductMapping = {
    platform,
    content_ref: contentRef,
    scope: 'time_window',
    timestamp_start_ms: Math.max(0, timestampMs - 5000),
    timestamp_end_ms: timestampMs + 5000,
    object_type: objectType,
    brand: bounded(product.brand, 120) || bounded(description.brand_candidate, 120),
    product_id: productId,
    title,
    destination,
    image_reference: bounded(product.image_reference, 1200) || null,
    provider: bounded(product.provider, 80) || bounded(product.provenance, 80) || null,
    provenance: 'automatic_verified',
  };

  const identity = canonicalProductIdentity({
    mapping,
    model: bounded(product.model, 160) || null,
    merchantItemId: bounded(product.id, 180) || null,
    visibleText: description.visible_text,
    color: description.color,
    material: description.material,
    styleAttributes: description.style_attributes,
    logosMarkings: description.logos_markings,
    distinctiveFeatures: description.distinctive_features,
    shapeSilhouette: description.shape_silhouette,
  });
  identity.merchant_refs = identity.merchant_refs.map((ref) => ({
    ...ref,
    price: product.price,
    currency: product.currency,
    fetched_at: new Date().toISOString(),
  }));

  return {
    identity,
    mapping: { ...mapping, canonical_key: identity.canonical_key },
  };
}
