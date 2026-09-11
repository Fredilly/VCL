import type { ObjectDescription } from './types.js';

export type ProductQuery = {
  query: string;
  category: string;
  subcategory: string;
  brand: string | null;
  model: string | null;
  attributes: string[];
};

export type ProductContext = {
  platform?: string | null;
  title?: string | null;
  url?: string | null;
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

const COLORS = ['black', 'white', 'grey', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'navy', 'purple', 'pink', 'brown', 'beige', 'cream', 'gold', 'silver'];
const MATERIALS = ['cotton', 'wool', 'cashmere', 'leather', 'suede', 'silk', 'linen', 'polyester', 'nylon', 'denim', 'ceramic', 'metal', 'glass', 'plastic'];

function normalized(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function containsPhrase(haystack: string, needle: string | null | undefined): boolean {
  const value = normalized(needle);
  return Boolean(value) && ` ${normalized(haystack)} `.includes(` ${value} `);
}

function typeFamilies(value: string): Set<string> {
  const text = normalized(value);
  return new Set(Object.entries(TYPE_TERMS)
    .filter(([, terms]) => terms.some((term) => containsPhrase(text, term)))
    .map(([family]) => family));
}

function namedValues(value: string, vocabulary: string[]): Set<string> {
  const text = normalized(value);
  return new Set(vocabulary.filter((term) => containsPhrase(text, term)));
}

function evidenceMatch(title: string, values: string[]): boolean {
  return values.some((value) => {
    const tokens = normalized(value).split(' ').filter((token) => token.length > 2);
    return tokens.length > 0 && tokens.filter((token) => normalized(title).includes(token)).length >= Math.max(1, Math.ceil(tokens.length * 0.6));
  });
}

function visualTypeText(description: ObjectDescription): string {
  return [
    description.subcategory,
    description.category,
    ...description.style_attributes,
    ...description.distinctive_features,
    ...description.shape_silhouette,
    ...description.search_terms,
  ].join(' ');
}

function contextTypes(description: ObjectDescription, context?: ProductContext): Set<string> {
  if (!context?.title) return new Set();
  const types = typeFamilies(context.title);
  if (!types.size) return types;
  if (description.brand_candidate && containsPhrase(context.title, description.brand_candidate)) return types;
  const visualTypes = typeFamilies(visualTypeText(description));
  return visualTypes.size === 0 && types.size === 1 ? types : new Set();
}

function selectedTypes(description: ObjectDescription, context?: ProductContext): Set<string> {
  const contextual = contextTypes(description, context);
  return contextual.size ? contextual : typeFamilies(visualTypeText(description));
}

function primaryType(description: ObjectDescription, context?: ProductContext): string | null {
  const types = selectedTypes(description, context);
  return types.size ? [...types][0] : null;
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

export function verifyProductCandidate(description: ObjectDescription, candidate: ProductCandidate, context?: ProductContext): ProductCandidate | null {
  const title = candidate.title || '';
  const expectedTypes = selectedTypes(description, context);
  const candidateTypes = typeFamilies(title);
  const reasons: string[] = [];
  let score = 0;

  if (expectedTypes.size && candidateTypes.size && ![...expectedTypes].some((type) => candidateTypes.has(type))) return null;

  const expectedColor = normalized(description.color);
  const candidateColors = namedValues(title, COLORS);
  if (expectedColor && candidateColors.size) {
    const colorMatches = [...candidateColors].some((color) => color === expectedColor || (expectedColor === 'grey' && color === 'gray') || (expectedColor === 'gray' && color === 'grey'));
    if (!colorMatches) return null;
    score += 15;
    reasons.push('color matches');
  }

  const expectedMaterial = normalized(description.material);
  const candidateMaterials = namedValues(title, MATERIALS);
  if (expectedMaterial && candidateMaterials.size) {
    if (!candidateMaterials.has(expectedMaterial)) score -= 15;
    else {
      score += 8;
      reasons.push('material matches');
    }
  }

  const selectedBrand = description.brand_candidate;
  const brandMatches = Boolean(selectedBrand && containsPhrase(title, selectedBrand));
  if (brandMatches) {
    score += 30;
    reasons.push('brand matches title');
  } else if (selectedBrand && candidate.brand && normalized(candidate.brand) === normalized(selectedBrand)) {
    score += 12;
    reasons.push('provider brand corroborates selection');
  }

  const modelMatches = Boolean(description.model_candidate && containsPhrase(title, description.model_candidate));
  if (modelMatches) {
    score += 35;
    reasons.push('model/product family matches title');
  }

  const typeMatches = expectedTypes.size > 0 && [...expectedTypes].some((type) => candidateTypes.has(type));
  if (typeMatches) {
    score += 25;
    reasons.push('product type matches');
  }
  if (contextTypes(description, context).size) {
    score += 8;
    reasons.push('surface context supports product type');
  }

  if (evidenceMatch(title, [...description.visible_text, ...description.logos_markings])) {
    score += 10;
    reasons.push('visible text or logo agrees');
  }
  if (evidenceMatch(title, [...description.distinctive_features, ...description.shape_silhouette])) {
    score += 8;
    reasons.push('distinctive detail or silhouette agrees');
  }

  const identityStrong = modelMatches || (brandMatches && typeMatches);
  const resultClass = identityStrong && score >= 55 ? 'LIKELY' : score >= 25 ? 'SIMILAR' : null;
  if (!resultClass) return null;
  return { ...candidate, result_class: resultClass, verification_score: score, verification_reasons: reasons };
}

export function buildProductQuery(description: ObjectDescription, context?: ProductContext): ProductQuery {
  const type = primaryType(description, context);
  const evidence = identityEvidence(description);
  const strongestEvidence = uniqueNonEmpty([
    ...description.visible_text,
    ...description.logos_markings,
    ...description.distinctive_features,
    ...description.shape_silhouette,
  ]).slice(0, 2);

  const ordered = uniqueNonEmpty([
    description.brand_candidate,
    description.model_candidate,
    type,
    description.color,
    description.material,
    ...strongestEvidence,
  ]);

  const fallback = uniqueNonEmpty([
    type,
    description.color,
    description.material,
    ...description.style_attributes.slice(0, 2),
    ...description.search_terms.slice(0, 1),
  ]);

  const query = ordered.join(' ').trim() || fallback.join(' ').trim();

  return {
    query,
    category: description.category,
    subcategory: description.subcategory,
    brand: description.brand_candidate,
    model: description.model_candidate,
    attributes: uniqueNonEmpty([
      type,
      description.color,
      description.material,
      ...evidence,
      ...description.style_attributes,
    ]),
  };
}

export function buildProductQueryVariants(description: ObjectDescription, context?: ProductContext): ProductQuery[] {
  const base = buildProductQuery(description, context);
  const type = primaryType(description, context);
  const variants = [base.query];

  const identity = uniqueNonEmpty([
    description.brand_candidate,
    description.model_candidate,
    type,
    description.color,
  ]).join(' ');
  if (identity) variants.push(identity);

  const visual = uniqueNonEmpty([
    type,
    description.color,
    description.material,
    ...description.style_attributes.slice(0, 2),
  ]).join(' ');
  if (visual) variants.push(visual);

  return [...new Set(variants.map((query) => query.trim()).filter(Boolean))].slice(0, 3).map((query) => ({
    ...base,
    query,
  }));
}
