import type { ObjectDescription } from './types.js';
import type { CanonicalProductIdentity } from './canonical-product-memory.js';
import type { VerifiedProductMapping } from './verified-product-mapping.js';
import { normalizeIdentityText } from './canonical-product-memory.js';
import { canonical, compatible, type ImageComparison } from './verification-evidence.js';

export type SameVideoReuseReason =
  | 'model_exact'
  | 'distinctive_text_exact'
  | 'fingerprint_candidate'
  | 'brand_conflict'
  | 'model_conflict'
  | 'color_conflict'
  | 'object_mismatch'
  | 'weak_evidence'
  | 'ambiguous'
  | 'visual_confirmed'
  | 'visual_rejected'
  | 'visual_unavailable'
  | 'no_candidate';

export type SameVideoReuseDecision = {
  mapping: VerifiedProductMapping | null;
  canonical_key: string | null;
  confidence: number;
  reason: SameVideoReuseReason;
  requires_visual?: boolean;
  visual_similarity?: number;
  visual_confidence?: number;
};

const genericTokens = new Set([
  'black', 'white', 'shirt', 'shirts', 'tshirt', 'shirt', 'tee', 'tees', 'top', 'apparel',
  'short', 'long', 'sleeve', 'sleeves', 'oversized', 'cotton', 'graphic', 'design', 'printed',
  'print', 'embossed', 'unisex', 'men', 'women', 'adult', 'style', 'fashion', 'casual',
]);

function words(values: Array<string | null | undefined>): string[] {
  return normalizeIdentityText(values.filter(Boolean).join(' '))
    .split(' ')
    .filter((token) => token.length >= 3);
}

function distinctiveWords(values: Array<string | null | undefined>): string[] {
  return words(values).filter((token) => token.length >= 4 && !genericTokens.has(token));
}

function overlap(a: string[], b: string[]): { shared: number; ratio: number } {
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const denominator = Math.max(1, Math.min(left.size, right.size));
  return { shared, ratio: shared / denominator };
}

function listOverlap(a: string[] | undefined, b: string[] | undefined): { shared: number; ratio: number } {
  return overlap(distinctiveWords(a ?? []), distinctiveWords(b ?? []));
}

function objectCompatible(identity: CanonicalProductIdentity, description: ObjectDescription): boolean {
  const expected = canonical('subtype', identity.object_type) ?? normalizeIdentityText(identity.object_type);
  const actual = canonical('subtype', description.subcategory) ?? canonical('subtype', description.category)
    ?? normalizeIdentityText(`${description.category} ${description.subcategory}`);
  if (!expected || !actual) return false;
  if (expected === actual || actual.includes(expected) || expected.includes(actual)) return true;
  const shirtWords = ['shirt', 't shirt', 'tee', 'apparel'];
  return shirtWords.some((value) => expected.includes(value)) && shirtWords.some((value) => actual.includes(value));
}

function sameColor(identity: CanonicalProductIdentity, description: ObjectDescription): boolean | null {
  const expected = canonical('color', identity.color);
  const actual = canonical('color', description.color);
  if (!expected || !actual) return null;
  return expected === actual;
}

function candidateSignals(identity: CanonicalProductIdentity, description: ObjectDescription) {
  const storedIdentityWords = distinctiveWords([
    ...identity.visible_text,
    ...(identity.logos_markings ?? []),
    identity.title,
  ]);
  const observedIdentityWords = distinctiveWords([
    ...description.visible_text,
    ...description.logos_markings,
    ...description.search_terms,
  ]);
  const identityOverlap = overlap(storedIdentityWords, observedIdentityWords);
  const visibleOverlap = overlap(distinctiveWords(identity.visible_text), distinctiveWords(description.visible_text));
  const markingOverlap = listOverlap(identity.logos_markings, description.logos_markings);
  const featureOverlap = listOverlap(identity.distinctive_features, description.distinctive_features);
  const shapeOverlap = listOverlap(identity.shape_silhouette, description.shape_silhouette);
  const styleOverlap = listOverlap(identity.style_attributes, description.style_attributes);
  const color = sameColor(identity, description);

  const secondarySignals = [
    color === true,
    markingOverlap.shared >= 1 && markingOverlap.ratio >= 0.5,
    featureOverlap.shared >= 1 && featureOverlap.ratio >= 0.5,
    shapeOverlap.shared >= 1 && shapeOverlap.ratio >= 0.5,
    styleOverlap.shared >= 1 && styleOverlap.ratio >= 0.5,
  ].filter(Boolean).length;

  const exactVisiblePhrase = Boolean(
    normalizeIdentityText(identity.visible_text.join(' '))
    && normalizeIdentityText(identity.visible_text.join(' ')) === normalizeIdentityText(description.visible_text.join(' ')),
  );

  return { identityOverlap, visibleOverlap, markingOverlap, featureOverlap, shapeOverlap, styleOverlap, color, secondarySignals, exactVisiblePhrase };
}

export function chooseSameVideoVerifiedReuse(input: {
  description: ObjectDescription;
  candidates: Array<{ mapping: VerifiedProductMapping; identity: CanonicalProductIdentity }>;
}): SameVideoReuseDecision {
  const matches: SameVideoReuseDecision[] = [];
  let strongestMiss: SameVideoReuseDecision = { mapping: null, canonical_key: null, confidence: 0, reason: 'no_candidate' };

  for (const candidate of input.candidates) {
    const { mapping, identity } = candidate;
    if (!mapping.canonical_key || mapping.canonical_key !== identity.canonical_key) continue;
    if (!objectCompatible(identity, input.description)) {
      if (strongestMiss.reason === 'no_candidate') strongestMiss = { mapping: null, canonical_key: null, confidence: 0, reason: 'object_mismatch' };
      continue;
    }

    const expectedBrand = normalizeIdentityText(identity.brand);
    const observedBrand = normalizeIdentityText(input.description.brand_candidate);
    if (expectedBrand && observedBrand && expectedBrand !== observedBrand) {
      strongestMiss = { mapping: null, canonical_key: null, confidence: 0, reason: 'brand_conflict' };
      continue;
    }

    const expectedModel = normalizeIdentityText(identity.model);
    const observedModel = normalizeIdentityText(input.description.model_candidate);
    if (expectedModel && observedModel && expectedModel !== observedModel) {
      strongestMiss = { mapping: null, canonical_key: null, confidence: 0, reason: 'model_conflict' };
      continue;
    }

    const color = sameColor(identity, input.description);
    if (color === false) {
      strongestMiss = { mapping: null, canonical_key: null, confidence: 0, reason: 'color_conflict' };
      continue;
    }

    if (expectedModel && observedModel && expectedModel === observedModel) {
      matches.push({ mapping, canonical_key: identity.canonical_key, confidence: 1, reason: 'model_exact', requires_visual: false });
      continue;
    }

    const signals = candidateSignals(identity, input.description);
    const strongText = signals.exactVisiblePhrase
      || (signals.visibleOverlap.shared >= 3 && signals.visibleOverlap.ratio >= 0.75)
      || (signals.identityOverlap.shared >= 4 && signals.identityOverlap.ratio >= 0.65);
    const partialIdentity = signals.identityOverlap.shared >= 1 && signals.secondarySignals >= 3;
    const structuralCandidate = signals.identityOverlap.shared === 0
      && signals.color === true
      && signals.secondarySignals >= 2;

    if (strongText || partialIdentity || structuralCandidate) {
      const confidence = strongText ? 0.9 : partialIdentity ? 0.82 : 0.72;
      matches.push({
        mapping,
        canonical_key: identity.canonical_key,
        confidence,
        reason: 'fingerprint_candidate',
        requires_visual: true,
      });
      continue;
    }

    if (strongestMiss.reason === 'no_candidate' || strongestMiss.reason === 'object_mismatch') {
      strongestMiss = { mapping: null, canonical_key: null, confidence: 0.2, reason: 'weak_evidence' };
    }
  }

  const uniqueKeys = new Set(matches.map((match) => match.canonical_key));
  if (uniqueKeys.size > 1) return { mapping: null, canonical_key: null, confidence: 0, reason: 'ambiguous' };
  return matches.sort((a, b) => b.confidence - a.confidence)[0] ?? strongestMiss;
}


export function confirmSameVideoVisual(
  decision: SameVideoReuseDecision,
  comparison: ImageComparison | null | undefined,
): SameVideoReuseDecision {
  if (!decision.mapping || !decision.requires_visual) return decision;
  if (!comparison) return { ...decision, mapping: null, canonical_key: null, confidence: 0, reason: 'visual_unavailable' };

  const critical = ['subtype', 'color', 'sleeve', 'brand', 'model'] as const;
  for (const key of critical) {
    const source = comparison.source[key];
    const candidate = comparison.candidate[key];
    const a = canonical(key, source?.value);
    const b = canonical(key, candidate?.value);
    if (!a || !b || !source || !candidate) continue;
    if (source.confidence >= 0.8 && candidate.confidence >= 0.8 && !compatible(key, a, b)) {
      return {
        ...decision,
        mapping: null,
        canonical_key: null,
        confidence: 0,
        reason: 'visual_rejected',
        visual_similarity: comparison.similarity,
        visual_confidence: comparison.confidence,
      };
    }
  }

  const specificDetails = (comparison.matching_details ?? []).filter((detail) => {
    const useful = distinctiveWords([detail]);
    return useful.length >= 2;
  });

  if (comparison.confidence < 0.90 || comparison.similarity < 0.90 || specificDetails.length < 1) {
    return {
      ...decision,
      mapping: null,
      canonical_key: null,
      confidence: 0,
      reason: 'visual_rejected',
      visual_similarity: comparison.similarity,
      visual_confidence: comparison.confidence,
    };
  }

  return {
    ...decision,
    confidence: Math.min(0.99, Math.max(decision.confidence, comparison.similarity)),
    reason: 'visual_confirmed',
    requires_visual: false,
    visual_similarity: comparison.similarity,
    visual_confidence: comparison.confidence,
  };
}


export type SameVideoCanonicalCandidate = {
  mapping: VerifiedProductMapping;
  identity: CanonicalProductIdentity;
};

function mergeUnique(values: Array<string | null | undefined>, maxItems = 24): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].slice(0, maxItems);
}

export function identityWithTrustedVpmObservations(
  identity: CanonicalProductIdentity,
  mapping: VerifiedProductMapping,
): CanonicalProductIdentity {
  const observations = mapping.trusted_observations ?? [];
  if (!observations.length) return identity;
  return {
    ...identity,
    visible_text: mergeUnique([...(identity.visible_text ?? []), ...observations.flatMap((o) => o.visible_text ?? [])]),
    logos_markings: mergeUnique([...(identity.logos_markings ?? []), ...observations.flatMap((o) => o.logos_markings ?? [])]),
    distinctive_features: mergeUnique([...(identity.distinctive_features ?? []), ...observations.flatMap((o) => o.distinctive_features ?? [])]),
    shape_silhouette: mergeUnique([...(identity.shape_silhouette ?? []), ...observations.flatMap((o) => o.shape_silhouette ?? [])]),
    style_attributes: mergeUnique([...(identity.style_attributes ?? []), ...observations.flatMap((o) => o.style_attributes ?? [])]),
  };
}

function objectFamily(value: string | null | undefined): string {
  const normalized = normalizeIdentityText(value);
  if (!normalized) return '';
  const families: Array<[string, string[]]> = [
    ['bag', ['bag', 'handbag', 'shoulder bag', 'crossbody', 'purse', 'tote', 'clutch', 'satchel']],
    ['shoe', ['shoe', 'shoes', 'sneaker', 'sneakers', 'trainer', 'trainers', 'boot', 'boots', 'loafer', 'loafers']],
    ['shirt', ['shirt', 't shirt', 'tee', 'top', 'apparel']],
    ['outerwear', ['jacket', 'coat', 'blazer', 'outerwear']],
    ['watch', ['watch', 'wristwatch', 'timepiece']],
    ['eyewear', ['glasses', 'sunglasses', 'eyewear', 'frames']],
    ['fragrance', ['fragrance', 'perfume', 'cologne', 'eau de parfum', 'eau de toilette']],
  ];
  for (const [family, values] of families) {
    if (values.some((candidate) => normalized === candidate || normalized.includes(candidate))) return family;
  }
  return normalized;
}

function vpmTrackCompatible(identity: CanonicalProductIdentity, description: ObjectDescription): boolean {
  const expectedBrand = normalizeIdentityText(identity.brand);
  const observedBrand = normalizeIdentityText(description.brand_candidate);
  if (expectedBrand && observedBrand && expectedBrand !== observedBrand) return false;

  const expectedFamily = objectFamily(identity.object_type);
  const observedFamily = objectFamily(description.subcategory || description.category);
  if (expectedFamily && observedFamily && expectedFamily !== observedFamily) return false;

  return true;
}

export function verifiedProductMemoryCandidates(input: {
  description: ObjectDescription;
  candidates: SameVideoCanonicalCandidate[];
}): SameVideoCanonicalCandidate[] {
  // Explicit Product Memory tracks belong to this video, so later frames should not
  // be discarded because the vision description drifted on color/model/subtype.
  // Keep only clear brand/object-family contradictions here; the existing strict
  // visual verifier remains authoritative for Exact.
  const unique = new Map<string, SameVideoCanonicalCandidate>();
  for (const candidate of input.candidates) {
    const { mapping, identity } = candidate;
    if (!mapping.canonical_key || mapping.canonical_key !== identity.canonical_key) continue;
    if (!mapping.track_id || mapping.track_id !== identity.canonical_key) continue;
    if (!vpmTrackCompatible(identity, input.description)) continue;
    if (!unique.has(identity.canonical_key)) unique.set(identity.canonical_key, candidate);
  }
  return [...unique.values()];
}

export function eligibleSameVideoCanonicalCandidates(input: {
  description: ObjectDescription;
  candidates: SameVideoCanonicalCandidate[];
}): SameVideoCanonicalCandidate[] {
  const unique = new Map<string, SameVideoCanonicalCandidate>();

  for (const candidate of input.candidates) {
    const { mapping, identity } = candidate;
    if (!mapping.canonical_key || mapping.canonical_key !== identity.canonical_key) continue;
    if (!objectCompatible(identity, input.description)) continue;

    const expectedBrand = normalizeIdentityText(identity.brand);
    const observedBrand = normalizeIdentityText(input.description.brand_candidate);
    if (expectedBrand && observedBrand && expectedBrand !== observedBrand) continue;

    const expectedModel = normalizeIdentityText(identity.model);
    const observedModel = normalizeIdentityText(input.description.model_candidate);
    if (expectedModel && observedModel && expectedModel !== observedModel) continue;

    const color = sameColor(identity, input.description);
    if (color === false) continue;

    if (!unique.has(identity.canonical_key)) unique.set(identity.canonical_key, candidate);
  }

  return [...unique.values()];
}

export function distinctiveTextSameVideoReuse(input: {
  description: ObjectDescription;
  candidates: SameVideoCanonicalCandidate[];
}): SameVideoReuseDecision {
  const eligible = eligibleSameVideoCanonicalCandidates(input);
  const matches = eligible.filter(({ mapping, identity }) => {
    // This shortcut is only authoritative for explicitly promoted product tracks.
    if (!mapping.track_id || mapping.track_id !== identity.canonical_key) return false;

    // Brand markings such as "LOUIS VUITTON PARIS" are not product identity.
    // Remove brand/location/authenticity boilerplate before deciding whether OCR
    // is distinctive enough to bypass image verification.
    const brandTokens = new Set(distinctiveWords([identity.brand]));
    const genericMarkingTokens = new Set([
      'paris', 'france', 'italy', 'spain', 'london', 'tokyo',
      'made', 'authentic', 'original', 'official', 'brand',
    ]);
    const stored = distinctiveWords(identity.visible_text)
      .filter((token) => !brandTokens.has(token) && !genericMarkingTokens.has(token));
    const observed = distinctiveWords(input.description.visible_text)
      .filter((token) => !brandTokens.has(token) && !genericMarkingTokens.has(token));
    if (stored.length < 3 || observed.length < 3) return false;

    const direct = overlap(stored, observed);
    const storedPhrase = stored.join(' ');
    const observedPhrase = observed.join(' ');
    return storedPhrase === observedPhrase
      || (direct.shared >= 3 && direct.ratio >= 0.75);
  });

  const keys = new Set(matches.map(({ identity }) => identity.canonical_key));
  if (keys.size !== 1 || matches.length !== 1) {
    return {
      mapping: null,
      canonical_key: null,
      confidence: 0,
      reason: matches.length > 1 ? 'ambiguous' : 'no_candidate',
    };
  }

  return {
    mapping: matches[0].mapping,
    canonical_key: matches[0].identity.canonical_key,
    confidence: 0.96,
    reason: 'distinctive_text_exact',
    requires_visual: false,
  };
}

export function exactModelSameVideoReuse(input: {
  description: ObjectDescription;
  candidates: SameVideoCanonicalCandidate[];
}): SameVideoReuseDecision {
  const observedModel = normalizeIdentityText(input.description.model_candidate);
  if (!observedModel) return { mapping: null, canonical_key: null, confidence: 0, reason: 'no_candidate' };

  const matches = eligibleSameVideoCanonicalCandidates(input).filter(({ identity }) =>
    Boolean(identity.model) && normalizeIdentityText(identity.model) === observedModel);

  if (matches.length !== 1) {
    return {
      mapping: null,
      canonical_key: null,
      confidence: 0,
      reason: matches.length > 1 ? 'ambiguous' : 'no_candidate',
    };
  }

  return {
    mapping: matches[0].mapping,
    canonical_key: matches[0].identity.canonical_key,
    confidence: 1,
    reason: 'model_exact',
    requires_visual: false,
  };
}

export function selectSameVideoVisualWinner(input: {
  candidates: SameVideoCanonicalCandidate[];
  comparisons: Map<string, ImageComparison>;
}): SameVideoReuseDecision {
  const confirmed: SameVideoReuseDecision[] = [];
  let sawComparison = false;

  for (const { mapping, identity } of input.candidates) {
    const comparison = input.comparisons.get(identity.canonical_key);
    if (!comparison) continue;
    sawComparison = true;
    const decision: SameVideoReuseDecision = {
      mapping,
      canonical_key: identity.canonical_key,
      confidence: 0.7,
      reason: 'fingerprint_candidate',
      requires_visual: true,
    };
    const result = confirmSameVideoVisual(decision, comparison);
    if (result.mapping && result.reason === 'visual_confirmed') confirmed.push(result);
  }

  if (confirmed.length === 1) return confirmed[0];
  if (confirmed.length > 1) {
    return { mapping: null, canonical_key: null, confidence: 0, reason: 'ambiguous' };
  }

  const observed = [...input.comparisons.values()]
    .filter((comparison) => Number.isFinite(comparison.similarity) && Number.isFinite(comparison.confidence))
    .sort((a, b) => (b.similarity * b.confidence) - (a.similarity * a.confidence))[0];

  return {
    mapping: null,
    canonical_key: null,
    confidence: 0,
    reason: sawComparison ? 'visual_rejected' : 'visual_unavailable',
    ...(observed ? {
      visual_similarity: observed.similarity,
      visual_confidence: observed.confidence,
    } : {}),
  };
}


export function canonicalVisualExactOfferIds(input: {
  mapping: VerifiedProductMapping;
  products: Array<{ id: string }>;
  comparisons: Map<string, ImageComparison | undefined>;
}): Set<string> {
  const exact = new Set<string>();
  for (const product of input.products) {
    const comparison = input.comparisons.get(product.id);
    const confirmed = confirmSameVideoVisual({
      mapping: input.mapping,
      canonical_key: input.mapping.canonical_key ?? null,
      confidence: 0.7,
      reason: 'fingerprint_candidate',
      requires_visual: true,
    }, comparison);
    if (confirmed.mapping && confirmed.reason === 'visual_confirmed') exact.add(product.id);
  }
  return exact;
}

/**
 * Keep the strict visual veto introduced by the roster-outlier gate, but avoid
 * visually verifying the entire same-video roster when model/OCR evidence has
 * already nominated one unique candidate. The nomination only narrows the work;
 * it never grants Exact without the normal image verifier.
 */
export function sameVideoVisualVerificationCandidates(input: {
  description: ObjectDescription;
  candidates: SameVideoCanonicalCandidate[];
}): SameVideoCanonicalCandidate[] {
  const vpm = verifiedProductMemoryCandidates(input);
  const eligible = vpm.length ? vpm : eligibleSameVideoCanonicalCandidates(input);
  if (!eligible.length) return [];

  const model = exactModelSameVideoReuse({ description: input.description, candidates: eligible });
  if (model.mapping && model.canonical_key) {
    return eligible.filter(({ identity }) => identity.canonical_key === model.canonical_key);
  }

  const distinctive = distinctiveTextSameVideoReuse({ description: input.description, candidates: eligible });
  if (distinctive.mapping && distinctive.canonical_key) {
    return eligible.filter(({ identity }) => identity.canonical_key === distinctive.canonical_key);
  }

  return eligible;
}

/** Resolve recorded evidence in one place. Once image verification has been
 * attempted, text/model nomination cannot override rejection or missing images.
 * Omitted comparisons retain the evidence-only shortcut API for legacy callers.
 */
export function resolveSameVideoReuse(input: {
  description: ObjectDescription;
  candidates: SameVideoCanonicalCandidate[];
  comparisons?: Map<string, ImageComparison>;
}): SameVideoReuseDecision {
  if (input.comparisons !== undefined) {
    const vpm = verifiedProductMemoryCandidates(input);
    const eligible = vpm.length ? vpm : eligibleSameVideoCanonicalCandidates(input);
    return selectSameVideoVisualWinner({ candidates: eligible, comparisons: input.comparisons });
  }
  const model = exactModelSameVideoReuse(input);
  if (model.mapping) return model;
  return distinctiveTextSameVideoReuse(input);
}
