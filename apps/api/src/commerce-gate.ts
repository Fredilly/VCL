import type { ObjectDescription } from './types.js';

export type GateDecision = 'ALLOW' | 'RESTRICT' | 'REJECT';

export type CommerceGateResult = {
  decision: GateDecision;
  reason: string;
};

function normalize(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

function collectAttributes(description: ObjectDescription): string[] {
  return [
    ...description.style_attributes,
    ...description.distinctive_features,
    ...description.hardware_details,
    ...description.shape_silhouette,
  ].map(normalize).filter(Boolean);
}

export function evaluateCommerceGate(description: ObjectDescription): CommerceGateResult {
  const category = normalize(description.category);
  const subcategory = normalize(description.subcategory);
  const attributes = collectAttributes(description);

  const obviousNonProduct =
    category.includes('graphic art') ||
    subcategory.includes('illustration');

  if (obviousNonProduct) {
    return { decision: 'REJECT', reason: 'non_product_visual_class' };
  }

  const attributeText = attributes.join(' ');
  const packagingSignals =
    attributeText.includes('cardboard') &&
    (
      attributeText.includes('carrying handle') ||
      attributeText.includes('graphic') ||
      attributeText.includes('number print')
    );

  if (packagingSignals) {
    return { decision: 'REJECT', reason: 'packaging_evidence' };
  }

  if (description.brand_candidate && description.model_candidate) {
    return { decision: 'ALLOW', reason: 'brand_and_model_present' };
  }

  if (
    description.brand_candidate &&
    ['apparel', 'shoes', 'accessories'].includes(category)
  ) {
    return { decision: 'ALLOW', reason: 'brand_in_commercial_category' };
  }

  return { decision: 'RESTRICT', reason: 'incomplete_identity_evidence' };
}
