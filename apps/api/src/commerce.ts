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
  verification_score?: number;
  verification_reasons?: string[];
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

const TYPE_TERMS: Record<string, string[]> = {
  sweater: ['sweater', 'jumper', 'pullover', 'knit', 'cardigan', 'crewneck', 'hoodie'],
  polo: ['polo'],
  't-shirt': ['t-shirt', 'tshirt', 'tee'],
  shirt: ['shirt', 'blouse'],
  jacket: ['jacket', 'coat', 'blazer'],
  dress: ['dress'],
  trousers: ['trouser', 'pants', 'jeans', 'shorts'],
  sneakers: ['sneaker', 'trainer', 'running shoe'],
  shoes: ['shoe', 'loafer', 'boot', 'heel', 'sandal'],
  sunglasses: ['sunglasses', 'eyeglasses', 'glasses'],
  bag: ['bag', 'handbag', 'backpack', 'purse'],
  watch: ['watch'],
  mug: ['mug', 'cup'],
};

function normalized(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function containsPhrase(haystack: string, needle: string): boolean {
  const value = normalized(needle);
  return Boolean(value) && normalized(haystack).includes(value);
}

function typeFamilies(value: string): Set<string> {
  const text = normalized(value);
  return new Set(Object.entries(TYPE_TERMS).filter(([, terms]) => terms.some((term) => text.includes(normalized(term)))).map(([family]) => family));
}

function evidenceMatch(title: string, values: string[]): boolean {
  return values.some((value) => {
    const tokens = normalized(value).split(' ').filter((token) => token.length > 2);
    return tokens.length > 0 && tokens.filter((token) => normalized(title).includes(token)).length >= Math.max(1, Math.ceil(tokens.length * 0.6));
  });
}

export function verifyProductCandidate(description: ObjectDescription, candidate: ProductCandidate): ProductCandidate | null {
  const title = candidate.title || '';
  const selectedTypeText = `${description.category} ${description.subcategory} ${description.shape_silhouette.join(' ')}`;
  const candidateTypeText = `${title} ${candidate.category ?? ''}`;
  const selectedTypes = typeFamilies(selectedTypeText);
  const candidateTypes = typeFamilies(candidateTypeText);
  const reasons: string[] = [];
  let score = 0;

  if (selectedTypes.size && candidateTypes.size && ![...selectedTypes].some((type) => candidateTypes.has(type))) return null;

  const selectedBrand = description.brand_candidate;
  const brandMatches = Boolean(selectedBrand && containsPhrase(title, selectedBrand));
  if (brandMatches) { score += 30; reasons.push('brand matches title'); }
  else if (selectedBrand && candidate.brand && normalized(candidate.brand) === normalized(selectedBrand)) { score += 12; reasons.push('provider brand corroborates selection'); }

  const modelMatches = Boolean(description.model_candidate && containsPhrase(title, description.model_candidate));
  if (modelMatches) { score += 35; reasons.push('model/product family matches title'); }

  if (selectedTypes.size && candidateTypes.size && [...selectedTypes].some((type) => candidateTypes.has(type))) { score += 25; reasons.push('product type matches'); }
  else if (selectedTypes.size && candidateTypes.size) score -= 30;

  const attributes = [description.color, description.material].filter(Boolean);
  if (evidenceMatch(title, attributes)) { score += 5; reasons.push('color or material agrees'); }
  if (evidenceMatch(title, [...description.visible_text, ...description.logos_markings])) { score += 10; reasons.push('visible text or logo agrees'); }
  if (evidenceMatch(title, [...description.distinctive_features, ...description.shape_silhouette])) { score += 8; reasons.push('distinctive detail or silhouette agrees'); }

  const identityStrong = modelMatches || (brandMatches && selectedTypes.size > 0 && [...selectedTypes].some((type) => candidateTypes.has(type)));
  const resultClass = identityStrong && score >= 55 ? 'LIKELY' : score >= 25 ? 'SIMILAR' : null;
  if (!resultClass) return null;
  return { ...candidate, result_class: resultClass, verification_score: score, verification_reasons: reasons };
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
