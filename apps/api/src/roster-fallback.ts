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
