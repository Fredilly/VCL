import type { ObjectDescription } from './types.js';
import type { CanonicalProductIdentity } from './canonical-product-memory.js';
import type { ImageComparison } from './verification-evidence.js';
import { canonical, compatible } from './verification-evidence.js';
import { normalizeIdentityText } from './canonical-product-memory.js';

export type CrossVideoReuseDecision = {
  identity: CanonicalProductIdentity | null;
  canonical_key: string | null;
  confidence: number;
  reason: 'model_candidate' | 'distinctive_text_candidate' | 'visual_confirmed' | 'visual_rejected' | 'ambiguous' | 'no_candidate';
  visual_similarity?: number;
  visual_confidence?: number;
};

function words(values: Array<string | null | undefined>): string[] {
  return normalizeIdentityText(values.filter(Boolean).join(' '))
    .split(' ')
    .filter((token) => token.length >= 4);
}

function overlap(a: string[], b: string[]): { shared: number; ratio: number } {
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return { shared, ratio: shared / Math.max(1, Math.min(left.size, right.size)) };
}

function objectCompatible(identity: CanonicalProductIdentity, description: ObjectDescription): boolean {
  const expected = canonical('subtype', identity.object_type) ?? normalizeIdentityText(identity.object_type);
  const actual = canonical('subtype', description.subcategory)
    ?? canonical('subtype', description.category)
    ?? normalizeIdentityText(`${description.category} ${description.subcategory}`);
  if (!expected || !actual) return false;
  if (expected === actual || actual.includes(expected) || expected.includes(actual)) return true;
  const shirtWords = ['shirt', 't shirt', 'tee', 'apparel'];
  return shirtWords.some((value) => expected.includes(value)) && shirtWords.some((value) => actual.includes(value));
}

export function crossVideoCanonicalCandidates(input: {
  description: ObjectDescription;
  identities: CanonicalProductIdentity[];
}): CrossVideoReuseDecision[] {
  const observedBrand = normalizeIdentityText(input.description.brand_candidate);
  const observedModel = normalizeIdentityText(input.description.model_candidate);
  const observedText = words([
    ...input.description.visible_text,
    ...input.description.logos_markings,
    ...input.description.search_terms,
  ]);

  return input.identities.flatMap((identity): CrossVideoReuseDecision[] => {
    if (!objectCompatible(identity, input.description)) return [];

    const expectedBrand = normalizeIdentityText(identity.brand);
    if (expectedBrand && observedBrand && expectedBrand !== observedBrand) return [];

    const expectedModel = normalizeIdentityText(identity.model);
    if (expectedModel && observedModel && expectedModel !== observedModel) return [];

    const expectedColor = canonical('color', identity.color);
    const observedColor = canonical('color', input.description.color);
    if (expectedColor && observedColor && expectedColor !== observedColor) return [];

    if (expectedModel && observedModel && expectedModel === observedModel) {
      return [{
        identity,
        canonical_key: identity.canonical_key,
        confidence: 0.95,
        reason: 'model_candidate',
      }];
    }

    const strongIdentityText = [
      ...identity.visible_text,
      ...(identity.logos_markings ?? []),
    ];
    const identityText = words(strongIdentityText.length ? strongIdentityText : [identity.title]);
    const text = overlap(identityText, observedText);
    if (text.shared >= 3 && text.ratio >= 0.8) {
      return [{
        identity,
        canonical_key: identity.canonical_key,
        confidence: 0.9,
        reason: 'distinctive_text_candidate',
      }];
    }
    return [];
  });
}

export function confirmCrossVideoVisual(
  candidates: CrossVideoReuseDecision[],
  comparisons: Map<string, ImageComparison>,
): CrossVideoReuseDecision {
  const confirmed: CrossVideoReuseDecision[] = [];

  for (const candidate of candidates) {
    if (!candidate.identity || !candidate.canonical_key) continue;
    const comparison = comparisons.get(candidate.canonical_key);
    if (!comparison) continue;

    const critical = ['subtype', 'color', 'sleeve', 'brand', 'model'] as const;
    let contradicted = false;
    for (const key of critical) {
      const source = comparison.source[key];
      const target = comparison.candidate[key];
      const a = canonical(key, source?.value);
      const b = canonical(key, target?.value);
      if (!a || !b || !source || !target) continue;
      if (source.confidence >= 0.85 && target.confidence >= 0.85 && !compatible(key, a, b)) {
        contradicted = true;
        break;
      }
    }
    if (contradicted) continue;

    const specificDetails = (comparison.matching_details ?? [])
      .filter((detail) => words([detail]).length >= 2);

    if (comparison.similarity < 0.94 || comparison.confidence < 0.94 || specificDetails.length < 1) continue;

    confirmed.push({
      ...candidate,
      confidence: Math.min(0.99, Math.max(candidate.confidence, comparison.similarity)),
      reason: 'visual_confirmed',
      visual_similarity: comparison.similarity,
      visual_confidence: comparison.confidence,
    });
  }

  if (confirmed.length === 1) return confirmed[0];
  if (confirmed.length > 1) {
    return { identity: null, canonical_key: null, confidence: 0, reason: 'ambiguous' };
  }
  return { identity: null, canonical_key: null, confidence: 0, reason: candidates.length ? 'visual_rejected' : 'no_candidate' };
}
