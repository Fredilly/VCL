import type { CanonicalRelationship } from './commerce.js';
import type { VerifiedProductMapping, VerifiedProductProvenance } from './verified-product-mapping.js';

export type CanonicalMerchantRef = {
  /** Stable merchant-offer identity. This is deliberately separate from canonical product identity. */
  offer_key?: string;
  source: string | null;
  item_id: string | null;
  destination: string;
  image_reference: string | null;
};

export type CanonicalVisualReference = {
  reference_key: string;
  image_url: string;
  provenance: 'partner_catalog' | 'admin_verified' | 'merchant_verified' | 'web_verified';
  viewpoint?: string | null;
  namespace?: string | null;
  vector_id?: string | null;
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
  /** Relationship of this verified identity to its canonical product/design node. */
  relationship: CanonicalRelationship;
  provenance: VerifiedProductProvenance;
  verified_at: string;
  merchant_refs: CanonicalMerchantRef[];
  visual_references?: CanonicalVisualReference[];
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
  visualReferences?: CanonicalVisualReference[];
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

function normalizeVisualReferences(values: CanonicalVisualReference[] | undefined, maxItems = 12): CanonicalVisualReference[] {
  const unique = new Map<string, CanonicalVisualReference>();
  for (const value of values ?? []) {
    const imageUrl = bounded(value.image_url, 1200);
    const key = bounded(value.reference_key, 240) || imageUrl;
    if (!imageUrl || !key) continue;
    let valid = false;
    try {
      const url = new URL(imageUrl);
      valid = url.protocol === 'https:' || url.protocol === 'http:';
    } catch {}
    if (!valid) continue;
    if (!unique.has(key)) {
      unique.set(key, {
        reference_key: key,
        image_url: imageUrl,
        provenance: value.provenance,
        viewpoint: bounded(value.viewpoint, 80) || null,
        namespace: bounded(value.namespace, 160) || null,
        vector_id: bounded(value.vector_id, 220) || null,
      });
    }
  }
  return [...unique.values()].slice(0, maxItems);
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

export function canonicalMerchantOfferKey(ref: Pick<CanonicalMerchantRef, 'source' | 'item_id' | 'destination'>): string {
  const source = normalizeIdentityText(ref.source) || 'unknown';
  const item = normalizeIdentityText(ref.item_id);
  if (item) return `${source}:${item}`;
  let destination = ref.destination.trim();
  try {
    const url = new URL(destination);
    url.search = '';
    url.hash = '';
    destination = url.toString().replace(/\/$/, '');
  } catch {}
  return `${source}:${destination.toLowerCase()}`;
}


export function canonicalEquivalenceEvidenceKey(identity: Pick<CanonicalProductIdentity,
  'brand' | 'model' | 'object_type' | 'visible_text' | 'logos_markings' | 'color'
>): string | null {
  const objectType = normalizeIdentityText(identity.object_type);
  if (!objectType) return null;

  const brand = normalizeIdentityText(identity.brand);
  const model = normalizeIdentityText(identity.model);
  if (model) return `model|${objectType}|${brand || '_'}|${model}`;

  const color = normalizeIdentityText(identity.color);
  if (!color) return null;

  const phrases = [
    ...(identity.visible_text ?? []),
    ...(identity.logos_markings ?? []),
  ]
    .map((value) => normalizeIdentityText(value))
    .filter((value) => value.split(' ').filter(Boolean).length >= 4 && value.length >= 18)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  const phrase = phrases[0];
  if (!phrase) return null;

  return `marking|${objectType}|${color}|${phrase}`;
}


function identityWords(values: Array<string | null | undefined>): string[] {
  return normalizeIdentityText(values.filter(Boolean).join(' '))
    .split(' ')
    .filter((token) => token.length >= 2);
}

function wordOverlap(a: string[], b: string[]): { shared: number; ratio: number } {
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return { shared, ratio: shared / Math.max(1, Math.min(left.size, right.size)) };
}

export function canonicalProductsEquivalent(
  a: Pick<CanonicalProductIdentity, 'title' | 'brand' | 'model' | 'object_type' | 'visible_text' | 'logos_markings' | 'color'>,
  b: Pick<CanonicalProductIdentity, 'title' | 'brand' | 'model' | 'object_type' | 'visible_text' | 'logos_markings' | 'color'>,
): boolean {
  const typeA = normalizeIdentityText(a.object_type);
  const typeB = normalizeIdentityText(b.object_type);
  if (!typeA || !typeB || typeA !== typeB) return false;

  const brandA = normalizeIdentityText(a.brand);
  const brandB = normalizeIdentityText(b.brand);
  if (brandA && brandB && brandA !== brandB) return false;

  const modelA = normalizeIdentityText(a.model);
  const modelB = normalizeIdentityText(b.model);
  if (modelA && modelB) return modelA === modelB && (!brandA || !brandB || brandA === brandB);
  if (modelA || modelB) return false;

  const colorA = normalizeIdentityText(a.color);
  const colorB = normalizeIdentityText(b.color);
  if (colorA && colorB && colorA !== colorB) return false;

  const strongA = identityWords([
    ...(a.visible_text ?? []),
    ...(a.logos_markings ?? []),
  ]);
  const strongB = identityWords([
    ...(b.visible_text ?? []),
    ...(b.logos_markings ?? []),
  ]);
  const titleA = identityWords([a.title]);
  const titleB = identityWords([b.title]);

  const direct = wordOverlap(strongA, strongB);
  if (strongA.length >= 4 && strongB.length >= 4) {
    return direct.shared >= 4 && direct.ratio >= 0.8;
  }

  const checks = [
    direct,
    ...(strongA.length >= 4 ? [wordOverlap(strongA, titleB)] : []),
    ...(strongB.length >= 4 ? [wordOverlap(titleA, strongB)] : []),
  ];
  return checks.some((match) => match.shared >= 4 && match.ratio >= 0.8);
}

export function canonicalIdentityHasMerchantOffer(
  identity: Pick<CanonicalProductIdentity, 'merchant_refs'>,
  ref: Pick<CanonicalMerchantRef, 'source' | 'item_id' | 'destination'>,
): boolean {
  const target = canonicalMerchantOfferKey(ref);
  return identity.merchant_refs.some((current) =>
    (current.offer_key || canonicalMerchantOfferKey(current)) === target);
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
  const visualReferences = normalizeVisualReferences(input.visualReferences);
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
    relationship: 'EXACT',
    provenance: mapping.provenance,
    verified_at: input.verifiedAt ?? new Date().toISOString(),
    merchant_refs: [{
      offer_key: canonicalMerchantOfferKey({ source, item_id: merchantItemId, destination: mapping.destination }),
      source,
      item_id: merchantItemId,
      destination: mapping.destination,
      image_reference: mapping.image_reference ?? null,
    }],
    visual_references: normalizeVisualReferences([
      ...visualReferences,
      ...(mapping.image_reference ? [{
        reference_key: `merchant:${canonicalMerchantOfferKey({ source, item_id: merchantItemId, destination: mapping.destination })}`,
        image_url: mapping.image_reference,
        provenance: 'merchant_verified' as const,
        viewpoint: null,
        namespace: null,
        vector_id: null,
      }] : []),
    ]),
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
    const incomingKey = ref.offer_key || canonicalMerchantOfferKey(ref);
    const duplicateIndex = merchantRefs.findIndex((current) =>
      (current.offer_key || canonicalMerchantOfferKey(current)) === incomingKey);
    if (duplicateIndex < 0) {
      merchantRefs.push({ ...ref, offer_key: incomingKey });
      continue;
    }
    const current = merchantRefs[duplicateIndex];
    if (!current.image_reference && ref.image_reference) {
      merchantRefs[duplicateIndex] = { ...current, image_reference: ref.image_reference };
    }
  }

  const visualReferences = normalizeVisualReferences([
    ...(existing.visual_references ?? []),
    ...(incoming.visual_references ?? []),
  ]);

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
    visual_references: visualReferences,
  };
}
