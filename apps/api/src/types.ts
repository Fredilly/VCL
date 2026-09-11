export type ObjectDescription = {
  category: string;
  subcategory: string;
  brand_candidate: string | null;
  model_candidate: string | null;
  color: string;
  material: string;
  style_attributes: string[];
  search_terms: string[];
  confidence: number;
};

export function normalizeObjectDescription(value: unknown): ObjectDescription {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Vision output was not an object.');
  }

  const record = value as Record<string, unknown>;
  const confidence = Number(record.confidence ?? 0);
  if (!Number.isFinite(confidence)) throw new Error('Vision output had invalid confidence.');

  return {
    category: typeof record.category === 'string' ? record.category : '',
    subcategory: typeof record.subcategory === 'string' ? record.subcategory : '',
    brand_candidate: record.brand_candidate == null ? null : String(record.brand_candidate),
    model_candidate: record.model_candidate == null ? null : String(record.model_candidate),
    color: typeof record.color === 'string' ? record.color : '',
    material: typeof record.material === 'string' ? record.material : '',
    style_attributes: Array.isArray(record.style_attributes) ? record.style_attributes.map(String).slice(0, 12) : [],
    search_terms: Array.isArray(record.search_terms) ? record.search_terms.map(String).slice(0, 4) : [],
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}

export interface VisionProvider {
  analyzeSelection(dataUrl: string): Promise<ObjectDescription>;
}
