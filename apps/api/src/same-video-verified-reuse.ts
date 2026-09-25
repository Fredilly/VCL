import type { ObjectDescription } from './types.js';
import type { CanonicalProductIdentity } from './canonical-product-memory.js';
import type { VerifiedProductMapping } from './verified-product-mapping.js';
import { normalizeIdentityText } from './canonical-product-memory.js';

export type SameVideoReuseDecision = {
  mapping: VerifiedProductMapping | null;
  canonical_key: string | null;
  confidence: number;
  reason: 'model_exact' | 'visible_text_exact' | 'visible_text_strong' | 'brand_conflict' | 'model_conflict' | 'object_mismatch' | 'weak_evidence' | 'ambiguous' | 'no_candidate';
};

function tokens(values: string[]): string[] {
  return normalizeIdentityText(values.join(' ')).split(' ').filter(Boolean);
}

function overlap(a: string[], b: string[]): { shared: number; ratio: number } {
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const denominator = Math.max(1, Math.min(left.size, right.size));
  return { shared, ratio: shared / denominator };
}

function objectCompatible(identity: CanonicalProductIdentity, description: ObjectDescription): boolean {
  const expected = normalizeIdentityText(identity.object_type);
  const actual = normalizeIdentityText(`${description.category} ${description.subcategory}`);
  if (!expected || !actual) return false;
  if (actual.includes(expected) || expected.includes(actual)) return true;
  const shirtWords = ['shirt', 't shirt', 'tshirt', 'tee', 'apparel'];
  return shirtWords.some((value) => expected.includes(value)) && shirtWords.some((value) => actual.includes(value));
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
    if (expectedModel && observedModel && expectedModel === observedModel) {
      matches.push({ mapping, canonical_key: identity.canonical_key, confidence: 1, reason: 'model_exact' });
      continue;
    }

    const storedText = tokens(identity.visible_text);
    const observedText = tokens(input.description.visible_text ?? []);
    if (storedText.length >= 3 && observedText.length >= 3) {
      const storedPhrase = normalizeIdentityText(identity.visible_text.join(' '));
      const observedPhrase = normalizeIdentityText((input.description.visible_text ?? []).join(' '));
      if (storedPhrase && observedPhrase && storedPhrase === observedPhrase) {
        matches.push({ mapping, canonical_key: identity.canonical_key, confidence: 0.99, reason: 'visible_text_exact' });
        continue;
      }
      const textOverlap = overlap(storedText, observedText);
      if (textOverlap.shared >= 4 && textOverlap.ratio >= 0.8) {
        matches.push({ mapping, canonical_key: identity.canonical_key, confidence: 0.95, reason: 'visible_text_strong' });
        continue;
      }
    }

    if (strongestMiss.reason === 'no_candidate' || strongestMiss.reason === 'object_mismatch') {
      strongestMiss = { mapping: null, canonical_key: null, confidence: 0.2, reason: 'weak_evidence' };
    }
  }

  const uniqueKeys = new Set(matches.map((match) => match.canonical_key));
  if (uniqueKeys.size > 1) return { mapping: null, canonical_key: null, confidence: 0, reason: 'ambiguous' };
  return matches.sort((a, b) => b.confidence - a.confidence)[0] ?? strongestMiss;
}
