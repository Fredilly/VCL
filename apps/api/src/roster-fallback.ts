import type { ObjectDescription } from './types.js';
import { normalizeIdentityText } from './canonical-product-memory.js';

/** A model's guessed family must not become search authority after roster rejection. */
export function rosterFallbackDescription(description: ObjectDescription): ObjectDescription {
  const model = normalizeIdentityText(description.model_candidate);
  if (!model) return description;
  const readable = [...description.visible_text,
    ...((description.evidence_confidence?.contextual_text ?? 0) >= .8 ? description.contextual_text ?? [] : [])];
  if (readable.some(text => (` ${normalizeIdentityText(text)} `).includes(` ${model} `))) return description;
  const grounded = (values: string[]) => values.filter(value => !(` ${normalizeIdentityText(value)} `).includes(` ${model} `));
  return { ...description, model_candidate: null, identity_confidence: 0,
    search_terms: [], distinctive_features: grounded(description.distinctive_features),
    style_attributes: grounded(description.style_attributes), shape_silhouette: grounded(description.shape_silhouette) };
}

/**
 * Retrieval may use the model's family guess as one bounded search hypothesis,
 * but verification must continue to use rosterFallbackDescription().
 *
 * This intentionally separates "what should we search for?" from
 * "what evidence is allowed to prove identity?". A wrong family guess can cost
 * one retrieval attempt; it cannot promote a candidate to LIKELY/EXACT.
 */
export function rosterFallbackRetrievalDescription(description: ObjectDescription): ObjectDescription {
  const safe = rosterFallbackDescription(description);
  if (safe.model_candidate || !description.model_candidate) return safe;
  return {
    ...safe,
    model_candidate: description.model_candidate,
    // Retrieval-only hypothesis. Do not restore identity authority.
    identity_confidence: 0,
  };
}
