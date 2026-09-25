import type { ObjectDescription } from './types.js';
import type { CanonicalProductIdentity } from './canonical-product-memory.js';
import type { VerifiedProductMapping } from './verified-product-mapping.js';
import { normalizeIdentityText } from './canonical-product-memory.js';
import { canonical, compatible, type ImageComparison } from './verification-evidence.js';

export type SameVideoReuseReason =
  | 'model_exact'
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

    if ((strongText && signals.secondarySignals >= 1) || partialIdentity) {
      const confidence = strongText ? 0.9 : 0.82;
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

  if (comparison.confidence < 0.85 || comparison.similarity < 0.92 || specificDetails.length < 1) {
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
