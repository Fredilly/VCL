import type { VerifiedProductMapping, VerifiedProductProvenance } from './verified-product-mapping.js';

export type CanonicalMerchantRef = {
  source: string | null;
  item_id: string | null;
  destination: string;
  image_reference: string | null;
};

export type CanonicalProductIdentity = {
  canonical_key: string;
  title: string;
  brand: string | null;
  model: string | null;
  object_type: string;
  visible_text: string[];
  color?: string | null;
  material?: string | null;
  style_attributes?: string[];
  logos_markings?: string[];
  distinctive_features?: string[];
  shape_silhouette?: string[];
  normalized_fingerprint: string;
  provenance: VerifiedProductProvenance;
  verified_at: string;
  merchant_refs: CanonicalMerchantRef[];
};

type CanonicalIdentityInput = {
  mapping: VerifiedProductMapping;
  model?: string | null;
  merchantItemId?: string | null;
  visibleText?: string[];
  color?: string | null;
  material?: string | null;
  styleAttributes?: string[];
  logosMarkings?: string[];
  distinctiveFeatures?: string[];
  shapeSilhouette?: string[];
  verifiedAt?: string;
};

function bounded(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function normalizeIdentityText(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function uniqueText(values: string[] | undefined, maxItems = 12): string[] {
  return [...new Set((values ?? [])
    .map((value) => bounded(value, 160))
    .filter(Boolean)
    .map((value) => value.replace(/\s+/g, ' ')))]
    .slice(0, maxItems);
}

function stableHash(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

function sourceFromMapping(mapping: VerifiedProductMapping): string | null {
  const provider = bounded(mapping.provider, 80);
  if (provider) return provider.toLowerCase();
  try { return new URL(mapping.destination).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return null; }
}

function normalizedFingerprint(input: {
  title: string;
  brand: string | null;
  model: string | null;
  objectType: string;
  visibleText: string[];
  color?: string | null;
  material?: string | null;
  styleAttributes?: string[];
  logosMarkings?: string[];
  distinctiveFeatures?: string[];
  shapeSilhouette?: string[];
}): string {
  return [
    `brand:${normalizeIdentityText(input.brand)}`,
    `model:${normalizeIdentityText(input.model)}`,
    `type:${normalizeIdentityText(input.objectType)}`,
    `title:${normalizeIdentityText(input.title)}`,
    `text:${input.visibleText.map(normalizeIdentityText).filter(Boolean).sort().join(' ')}`,
    `color:${normalizeIdentityText(input.color)}`,
    `material:${normalizeIdentityText(input.material)}`,
    `style:${(input.styleAttributes ?? []).map(normalizeIdentityText).filter(Boolean).sort().join(' ')}`,
    `markings:${(input.logosMarkings ?? []).map(normalizeIdentityText).filter(Boolean).sort().join(' ')}`,
    `features:${(input.distinctiveFeatures ?? []).map(normalizeIdentityText).filter(Boolean).sort().join(' ')}`,
    `shape:${(input.shapeSilhouette ?? []).map(normalizeIdentityText).filter(Boolean).sort().join(' ')}`,
  ].join('|');
}

export function canonicalProductIdentity(input: CanonicalIdentityInput): CanonicalProductIdentity {
  const mapping = input.mapping;
  const title = bounded(mapping.title, 300);
  const brand = bounded(mapping.brand, 120) || null;
  const model = bounded(input.model, 160) || null;
  const objectType = bounded(mapping.object_type, 100);
  const visibleText = uniqueText(input.visibleText);
  const color = bounded(input.color, 80) || null;
  const material = bounded(input.material, 120) || null;
  const styleAttributes = uniqueText(input.styleAttributes, 12);
  const logosMarkings = uniqueText(input.logosMarkings, 8);
  const distinctiveFeatures = uniqueText(input.distinctiveFeatures, 12);
  const shapeSilhouette = uniqueText(input.shapeSilhouette, 8);
  if (!title || !objectType) throw new Error('Canonical product identity needs title and object type');

  const normalized_fingerprint = normalizedFingerprint({
    title,
    brand,
    model,
    objectType,
    visibleText,
    color,
    material,
    styleAttributes,
    logosMarkings,
    distinctiveFeatures,
    shapeSilhouette,
  });
  const identityBasis = model
    ? [normalizeIdentityText(brand), normalizeIdentityText(model), normalizeIdentityText(objectType)].join('|')
    : [normalizeIdentityText(brand), normalizeIdentityText(title), normalizeIdentityText(objectType), visibleText.map(normalizeIdentityText).join(' ')].join('|');
  const source = sourceFromMapping(mapping);
  const merchantItemId = bounded(input.merchantItemId, 180) || null;

  return {
    canonical_key: `product:v1:${stableHash(identityBasis)}`,
    title,
    brand,
    model,
    object_type: objectType,
    visible_text: visibleText,
    color,
    material,
    style_attributes: styleAttributes,
    logos_markings: logosMarkings,
    distinctive_features: distinctiveFeatures,
    shape_silhouette: shapeSilhouette,
    normalized_fingerprint,
    provenance: mapping.provenance,
    verified_at: input.verifiedAt ?? new Date().toISOString(),
    merchant_refs: [{
      source,
      item_id: merchantItemId,
      destination: mapping.destination,
      image_reference: mapping.image_reference ?? null,
    }],
  };
}

function conflict(a: string | null, b: string | null): boolean {
  return Boolean(a && b && normalizeIdentityText(a) !== normalizeIdentityText(b));
}

export function mergeCanonicalProductIdentity(
  existing: CanonicalProductIdentity,
  incoming: CanonicalProductIdentity,
): CanonicalProductIdentity {
  if (existing.canonical_key !== incoming.canonical_key) throw new Error('Canonical product key mismatch');
  if (conflict(existing.brand, incoming.brand) || conflict(existing.model, incoming.model) || conflict(existing.object_type, incoming.object_type)) {
    throw new Error('Conflicting canonical product identity');
  }

  const merchantRefs = [...existing.merchant_refs];
  for (const ref of incoming.merchant_refs) {
    const duplicate = merchantRefs.some((current) =>
      normalizeIdentityText(current.source) === normalizeIdentityText(ref.source)
      && normalizeIdentityText(current.item_id) === normalizeIdentityText(ref.item_id)
      && current.destination === ref.destination);
    if (!duplicate) merchantRefs.push(ref);
  }

  return {
    ...existing,
    title: existing.title || incoming.title,
    brand: existing.brand ?? incoming.brand,
    model: existing.model ?? incoming.model,
    object_type: existing.object_type || incoming.object_type,
    visible_text: uniqueText([...existing.visible_text, ...incoming.visible_text]),
    color: existing.color ?? incoming.color ?? null,
    material: existing.material ?? incoming.material ?? null,
    style_attributes: uniqueText([...(existing.style_attributes ?? []), ...(incoming.style_attributes ?? [])], 12),
    logos_markings: uniqueText([...(existing.logos_markings ?? []), ...(incoming.logos_markings ?? [])], 8),
    distinctive_features: uniqueText([...(existing.distinctive_features ?? []), ...(incoming.distinctive_features ?? [])], 12),
    shape_silhouette: uniqueText([...(existing.shape_silhouette ?? []), ...(incoming.shape_silhouette ?? [])], 8),
    normalized_fingerprint: incoming.normalized_fingerprint || existing.normalized_fingerprint,
    provenance: existing.provenance,
    verified_at: incoming.verified_at,
    merchant_refs: merchantRefs.slice(0, 25),
  };
}
