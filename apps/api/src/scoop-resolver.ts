import { buildProductQueryVariants, type ProductContext, type ProductQuery } from './commerce.js';
import type { ObjectDescription } from './types.js';

export type ScoopEvidence = {
  object: ObjectDescription;
  context?: ProductContext;
};

export type ScoopIntentSummary = {
  title: string;
  details: string[];
};

export type ScoopIntent = {
  queries: ProductQuery[];
  summary: ScoopIntentSummary;
};

export type ScoopResult<TResolution> = {
  evidence: ScoopEvidence;
  intent: ScoopIntent;
  resolution: TResolution;
};

export type ScoopResolveInput = {
  evidence: ScoopEvidence;
  visible_text_first?: boolean;
};

export type ScoopResolutionExecutor<TResolution> = (input: {
  evidence: ScoopEvidence;
  intent: ScoopIntent;
}) => Promise<TResolution>;

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function groundedVisibleText(description: ObjectDescription): string[] {
  if ((description.evidence_confidence?.visible_text ?? 0) < 0.8) return [];
  return unique(description.visible_text).slice(0, 2);
}

export function buildScoopIntent(
  evidence: ScoopEvidence,
  visibleTextFirst = false,
): ScoopIntent {
  const description = evidence.object;
  const queries = buildProductQueryVariants(description, evidence.context, visibleTextFirst);
  const readable = groundedVisibleText(description);
  const identityText = readable.filter((value) =>
    ![description.brand_candidate, description.model_candidate].some(
      (identity) => identity && identity.trim().toLowerCase() === value.toLowerCase(),
    ));

  const titleParts = unique([
    description.brand_candidate,
    description.model_candidate,
    ...identityText,
    description.subcategory || description.category,
    description.color,
  ]);

  const title = titleParts.join(' ') || description.category || description.subcategory || 'Selected product';
  const titleLower = title.toLowerCase();
  const lowSignalMaterials = new Set(['polyester', 'cotton', 'synthetic']);
  const details = unique([
    ...description.logos_markings,
    ...description.distinctive_features,
    ...description.shape_silhouette,
    ...description.style_attributes,
    description.material,
  ])
    .filter((value) => !titleLower.includes(value.toLowerCase()))
    .sort((a, b) => Number(lowSignalMaterials.has(a.toLowerCase())) - Number(lowSignalMaterials.has(b.toLowerCase())))
    .slice(0, 2);

  return { queries, summary: { title, details } };
}

export class ScoopResolver<TResolution> {
  constructor(private readonly execute: ScoopResolutionExecutor<TResolution>) {}

  async resolve(input: ScoopResolveInput): Promise<ScoopResult<TResolution>> {
    const intent = buildScoopIntent(input.evidence, input.visible_text_first === true);
    const resolution = await this.execute({ evidence: input.evidence, intent });
    return { evidence: input.evidence, intent, resolution };
  }
}
