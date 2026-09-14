export type ObjectDescription = {
  category: string;
  subcategory: string;
  brand_candidate: string | null;
  model_candidate: string | null;
  color: string;
  material: string;
  style_attributes: string[];
  visible_text: string[];
  logos_markings: string[];
  distinctive_features: string[];
  hardware_details: string[];
  shape_silhouette: string[];
  search_terms: string[];
  confidence: number;
  identity_confidence: number;
  evidence_confidence?: Record<string, number>;
};

function stringArray(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, limit)
    : [];
}

export function normalizeObjectDescription(value: unknown): ObjectDescription {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Vision output was not an object.');
  }

  const record = value as Record<string, unknown>;
  const confidence = Number(record.confidence ?? 0);
  const identityConfidence = Number(record.identity_confidence ?? 0);
  if (!Number.isFinite(confidence)) throw new Error('Vision output had invalid confidence.');
  if (!Number.isFinite(identityConfidence)) throw new Error('Vision output had invalid identity confidence.');

  return {
    ...(record.evidence_confidence && typeof record.evidence_confidence === 'object' && !Array.isArray(record.evidence_confidence)
      ? { evidence_confidence: Object.fromEntries(Object.entries(record.evidence_confidence).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)) as Record<string, number> } : {}),
    category: typeof record.category === 'string' ? record.category : '',
    subcategory: typeof record.subcategory === 'string' ? record.subcategory : '',
    brand_candidate: record.brand_candidate == null ? null : String(record.brand_candidate),
    model_candidate: record.model_candidate == null ? null : String(record.model_candidate),
    color: typeof record.color === 'string' ? record.color : '',
    material: typeof record.material === 'string' ? record.material : '',
    style_attributes: stringArray(record.style_attributes, 12),
    visible_text: stringArray(record.visible_text, 8),
    logos_markings: stringArray(record.logos_markings, 8),
    distinctive_features: stringArray(record.distinctive_features, 12),
    hardware_details: stringArray(record.hardware_details, 8),
    shape_silhouette: stringArray(record.shape_silhouette, 8),
    search_terms: stringArray(record.search_terms, 4),
    confidence: Math.max(0, Math.min(1, confidence)),
    identity_confidence: Math.max(0, Math.min(1, identityConfidence)),
  };
}

export interface VisionProvider {
  analyzeSelection(dataUrl: string, point?: import('./selection-target.js').SelectionPoint): Promise<ObjectDescription>;
  locateSelection?(dataUrl: string, focusDataUrl: string, point: import('./selection-target.js').SelectionPoint): Promise<import('./selection-target.js').TargetBox>;
  analyzeNearbyFrame?(primary: string, nearby: string, description: ObjectDescription, point?: import('./selection-target.js').SelectionPoint): Promise<NearbyObservation>;
}

export type NearbyObservation = {
  description: ObjectDescription;
  same_object_confidence: number;
  identity_support: boolean;
};
