import type { ObjectDescription } from './types.js';

export type OcrEvidence = {
  visible_text: string[];
  logos_markings: string[];
  confidence: number;
};

const TEXT_SENSITIVE_TERMS = [
  'apparel','sportswear','jersey','fashion','t-shirt','tshirt','tee','shirt','hoodie','sweater','jumper','jacket','coat',
  'fragrance','perfume','cologne','watch','watches','sneaker','sneakers','shoe','shoes','bag','handbag',
  'toy','figure','figurine','collectible',
];

function clean(values: unknown, limit = 8): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(String).map((v) => v.trim()).filter(Boolean))].slice(0, limit);
}

export function ocrRecoveryEnabled(configured: string | undefined, benchmark: unknown): boolean {
  return configured === 'true' || benchmark === true;
}

export function shouldRunOcrRecovery(description: ObjectDescription): boolean {
  if (description.brand_candidate || description.model_candidate) return false;
  if (description.identity_confidence >= 0.6) return false;
  const text = [description.category, description.subcategory, ...description.distinctive_features]
    .join(' ').toLowerCase();
  return TEXT_SENSITIVE_TERMS.some((term) => text.includes(term));
}

export function normalizeOcrEvidence(value: unknown): OcrEvidence {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const confidence = Number(record.confidence ?? 0);
  return {
    visible_text: clean(record.visible_text),
    logos_markings: clean(record.logos_markings),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
  };
}

export function mergeOcrEvidence(description: ObjectDescription, evidence: OcrEvidence): ObjectDescription {
  if (evidence.confidence < 0.8 || (!evidence.visible_text.length && !evidence.logos_markings.length)) return description;
  const visibleText = [...new Set([...description.visible_text, ...evidence.visible_text])].slice(0, 8);
  const logosMarkings = [...new Set([...description.logos_markings, ...evidence.logos_markings])].slice(0, 8);
  return {
    ...description,
    visible_text: visibleText,
    logos_markings: logosMarkings,
    evidence_confidence: {
      ...(description.evidence_confidence ?? {}),
      ...(visibleText.length ? { visible_text: Math.max(description.evidence_confidence?.visible_text ?? 0, evidence.confidence) } : {}),
      ...(logosMarkings.length ? { logos_markings: Math.max(description.evidence_confidence?.logos_markings ?? 0, evidence.confidence) } : {}),
    },
  };
}

export const OCR_PROMPT = 'Read only identity-bearing text physically printed, stitched, embossed, engraved, labeled, or marked on the selected product. Ignore video subtitles, captions, creator overlays, watermarks, score graphics, and unrelated surrounding text. Return JSON only with exactly: {"visible_text":[],"logos_markings":[],"confidence":0..1}. Preserve readable word order and numbers. Do not infer missing words or guess a brand from style. confidence is confidence in the transcription itself.';
