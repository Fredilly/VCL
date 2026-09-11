import type { ObjectDescription } from './types.js';

export type ProductQuery = {
  query: string;
  category: string;
  subcategory: string;
  brand: string | null;
  model: string | null;
  attributes: string[];
};

export type ProductCandidate = {
  id: string;
  title: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  image_reference: string | null;
  provenance: string;
  destination: string | null;
  price: string | null;
  currency: string | null;
  result_class: 'LIKELY' | 'SIMILAR';
};

export interface CommerceProvider {
  search(query: ProductQuery): Promise<ProductCandidate[]>;
}

export class CommerceNoResultsError extends Error {
  readonly code = 'NO_RESULTS';

  constructor(message = 'No commerce results found.') {
    super(message);
    this.name = 'CommerceNoResultsError';
  }
}

export class CommerceProviderError extends Error {
  readonly code = 'COMMERCE_PROVIDER_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'CommerceProviderError';
  }
}

function uniqueNonEmpty(parts: Array<string | null | undefined>): string[] {
  return [...new Set(parts.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim()))];
}

function identityEvidence(description: ObjectDescription): string[] {
  return uniqueNonEmpty([
    ...description.visible_text,
    ...description.logos_markings,
    ...description.distinctive_features,
    ...description.hardware_details,
    ...description.shape_silhouette,
  ]);
}

export function buildProductQuery(description: ObjectDescription): ProductQuery {
  const evidence = identityEvidence(description);
  const parts = uniqueNonEmpty([
    description.brand_candidate,
    description.model_candidate,
    ...description.search_terms,
    ...evidence,
  ]);

  const fallback = uniqueNonEmpty([
    ...evidence,
    description.color,
    description.material,
    ...description.style_attributes,
    description.subcategory || description.category,
  ]).join(' ');

  const query = parts.slice(0, 4).join(' ').trim() || fallback.trim();

  return {
    query,
    category: description.category,
    subcategory: description.subcategory,
    brand: description.brand_candidate,
    model: description.model_candidate,
    attributes: uniqueNonEmpty([
      ...evidence,
      description.color,
      description.material,
      ...description.style_attributes,
    ]),
  };
}

export function buildProductQueryVariants(description: ObjectDescription): ProductQuery[] {
  const base = buildProductQuery(description);
  const variants = [base.query];
  const evidence = identityEvidence(description);

  const identity = uniqueNonEmpty([
    description.brand_candidate,
    description.model_candidate,
    ...description.visible_text.slice(0, 2),
    ...description.logos_markings.slice(0, 2),
    description.subcategory || description.category,
  ]).join(' ');
  if (identity) variants.push(identity);

  const visual = uniqueNonEmpty([
    ...evidence.slice(0, 4),
    description.color,
    description.material,
    ...description.style_attributes.slice(0, 2),
    description.subcategory || description.category,
  ]).join(' ');
  if (visual) variants.push(visual);

  return [...new Set(variants.map((query) => query.trim()).filter(Boolean))].slice(0, 3).map((query) => ({
    ...base,
    query,
  }));
}
