import type { ObjectDescription } from './types.js';

export type ProductQuery = {
  query: string;
  category: string;
  subcategory: string;
  brand: string | null;
  model: string | null;
  attributes: string[];
  affiliate_reference_id?: string | null;
};

export type ProductContext = {
  platform?: string | null;
  title?: string | null;
  url?: string | null;
  content_ref?: string | null;
  timestamp_ms?: number | null;
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
  result_class: 'EXACT' | 'LIKELY' | 'SIMILAR';
  metadata?: { brand?: string; model?: string; category?: string; description?: string; gender?: string; color?: string; sleeve?: string; material?: string; freshness?: string };
  verification_status?: 'multimodal' | 'metadata_only';
  verification_image_similarity?: number;
  verification_image_confidence?: number;
  identity_key?: string;
  verification_score?: number;
  verification_reasons?: string[];
  provider?: string;
  attribution_token?: string;
  click_ref?: string;
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
  sweater: ['sweater', 'sweaters', 'jumper', 'jumpers', 'pullover', 'pullovers', 'knit', 'knits', 'cardigan', 'cardigans', 'crewneck', 'crewnecks', 'hoodie', 'hoodies'],
  polo: ['polo', 'polos'],
  't-shirt': ['t-shirt', 't-shirts', 'tshirt', 'tshirts', 'tee', 'tees'],
  shirt: ['shirt', 'shirts', 'blouse', 'blouses'],
  jacket: ['jacket', 'jackets', 'coat', 'coats', 'blazer', 'blazers'],
  dress: ['dress', 'dresses'],
  trousers: ['trouser', 'trousers', 'pants', 'jeans', 'shorts'],
  sneakers: ['sneaker', 'sneakers', 'trainer', 'trainers', 'running shoe', 'running shoes'],
  shoes: ['shoe', 'shoes', 'loafer', 'loafers', 'boot', 'boots', 'heel', 'heels', 'sandal', 'sandals'],
  sunglasses: ['sunglasses', 'eyeglasses', 'glasses'],
  bag: ['bag', 'bags', 'handbag', 'handbags', 'backpack', 'backpacks', 'purse', 'purses'],
  watch: ['watch', 'watches'],
  mug: ['mug', 'mugs', 'cup', 'cups'],
  fragrance: ['perfume', 'perfumes', 'fragrance', 'fragrances', 'eau de parfum', 'eau de toilette', 'cologne'],
};

const COLORS = ['black', 'white', 'grey', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'navy', 'purple', 'pink', 'brown', 'beige', 'cream', 'gold', 'silver'];
const MATERIALS = ['cotton', 'wool', 'cashmere', 'leather', 'suede', 'silk', 'linen', 'polyester', 'nylon', 'denim', 'ceramic', 'metal', 'glass', 'plastic'];

type ParentAccessoryRule = {
  family: string;
  selected: string[];
  accessories: string[];
};

const PARENT_ACCESSORY_RULES: ParentAccessoryRule[] = [
  {
    family: 'vehicle',
    selected: ['vehicle', 'car', 'automobile', 'suv', 'sedan', 'truck', 'coupe', 'hatchback'],
    accessories: ['floor mat', 'floor mats', 'cargo liner', 'seat cover', 'car cover', 'window shade', 'sunshade', 'paint protection film', 'protection film', 'trim kit', 'replacement part', 'spare part'],
  },
  {
    family: 'phone',
    selected: ['phone', 'smartphone', 'mobile phone', 'cell phone'],
    accessories: ['phone case', 'protective case', 'case cover', 'screen protector', 'tempered glass', 'charging cable', 'charger', 'phone mount', 'phone holder', 'replacement screen', 'replacement battery'],
  },
  {
    family: 'camera',
    selected: ['camera', 'mirrorless camera', 'digital camera', 'dslr'],
    accessories: ['camera case', 'camera bag', 'camera strap', 'battery charger', 'replacement battery', 'lens cap', 'camera mount', 'tripod', 'camera cage'],
  },
  {
    family: 'watch',
    selected: ['watch', 'smartwatch', 'wristwatch'],
    accessories: ['watch strap', 'watch band', 'replacement band', 'replacement strap', 'watch charger', 'charging dock', 'watch case', 'screen protector'],
  },
  {
    family: 'furniture',
    selected: ['furniture', 'sofa', 'couch', 'chair', 'table', 'desk', 'bed', 'cabinet', 'dresser'],
    accessories: ['furniture cover', 'sofa cover', 'chair cover', 'table cover', 'slipcover', 'replacement leg', 'replacement hardware', 'hardware kit', 'furniture protector'],
  },
  {
    family: 'garment',
    selected: ['shirt', 't shirt', 'tshirt', 'sweater', 'jumper', 'hoodie', 'jacket', 'coat', 'blazer', 'dress', 'trousers', 'pants', 'jeans', 'shorts', 'skirt', 'polo'],
    accessories: ['belt', 'scarf', 'tie', 'necktie', 'hat', 'cap', 'handbag', 'bag', 'wallet', 'necklace', 'bracelet', 'sunglasses'],
  },
];

function hasPhrase(value: string, phraseValue: string): boolean {
  return containsPhrase(value, phraseValue);
}

function familySelectionText(description: ObjectDescription): string {
  return [
    description.category,
    description.subcategory,
    ...description.style_attributes,
    ...description.distinctive_features,
    ...description.shape_silhouette,
    ...description.search_terms,
  ].join(' ');
}

function candidateFamilyText(candidate: ProductCandidate): string {
  return [
    candidate.title,
    candidate.category,
    candidate.metadata?.category,
    candidate.metadata?.description,
  ].filter(Boolean).join(' ');
}

export function accessoryContradiction(description: ObjectDescription, candidate: ProductCandidate): string | null {
  const selectedText = familySelectionText(description);
  const observedText = candidateFamilyText(candidate);

  for (const rule of PARENT_ACCESSORY_RULES) {
    const selectedParent = rule.selected.some((term) => hasPhrase(selectedText, term));
    if (!selectedParent) continue;

    // If the selected object itself is clearly an accessory, do not reinterpret it as its parent.
    const selectedAccessory = rule.accessories.some((term) => hasPhrase(selectedText, term));
    if (selectedAccessory) continue;

    const accessory = rule.accessories.find((term) => hasPhrase(observedText, term));
    if (!accessory) continue;

    // Avoid rejecting clear bundles where the candidate explicitly names the parent product too.
    const namesParent = rule.selected.some((term) => hasPhrase(candidate.title, term));
    const bundleLanguage = /\b(with|includes|including|bundle|kit with)\b/i.test(candidate.title);
    if (namesParent && bundleLanguage) continue;

    return `${rule.family} accessory contradiction: selected parent object, candidate ${accessory}`;
  }
  return null;
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function containsPhrase(haystack: string, needle: string | null | undefined): boolean {
  const value = normalized(needle);
  return Boolean(value) && ` ${normalized(haystack)} `.includes(` ${value} `);
}

function typeFamilies(value: string): Set<string> {
  const text = normalized(value);
  const found = new Set(Object.entries(TYPE_TERMS)
    .filter(([, terms]) => terms.some((term) => containsPhrase(text, term)))
    .map(([family]) => family));

  if (found.has('polo') || found.has('t-shirt')) found.delete('shirt');
  if (found.has('sneakers')) found.delete('shoes');
  return found;
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
  const visualTypes = typeFamilies(visualTypeText(description));
  if (visualTypes.size) return new Set();

  const types = typeFamilies(context.title);
  if (!types.size) return types;
  if (description.brand_candidate && containsPhrase(context.title, description.brand_candidate) && types.size === 1) return types;
  return visualTypes.size === 0 && types.size === 1 ? types : new Set();
}

function selectedTypes(description: ObjectDescription, context?: ProductContext): Set<string> {
  const visualTypes = typeFamilies(visualTypeText(description));
  if (visualTypes.size) return visualTypes;
  const contextual = contextTypes(description, context);
  return contextual.size ? contextual : visualTypes;
}

function primaryType(description: ObjectDescription, context?: ProductContext): string | null {
  const types = selectedTypes(description, context);
  if (!types.size) return null;
  const type = [...types][0];
  return typeFamilies(description.subcategory).has(type) ? description.subcategory : type;
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
  const accessoryConflict = accessoryContradiction(description, candidate);
  if (accessoryConflict) return null;
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

  const hasStrongIdentity = Boolean(description.brand_candidate || description.model_candidate || type);
  const ordered = hasStrongIdentity
    ? uniqueNonEmpty([
        description.brand_candidate,
        description.model_candidate,
        type,
        description.color,
        description.material,
        ...strongestEvidence,
      ])
    : uniqueNonEmpty([
        description.color,
        description.material,
        ...description.style_attributes,
        description.subcategory || description.category,
        ...strongestEvidence,
      ]);

  const query = ordered.join(' ').trim();

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

export function buildProductQueryVariants(description: ObjectDescription, context?: ProductContext, visibleTextFirst = false): ProductQuery[] {
  const base = buildProductQuery(description, context);
  const type = primaryType(description, context);
  const readableText = description.visible_text.map((value) => value.trim()).filter(Boolean).slice(0, 2);
  const groundedReadableText = (description.evidence_confidence?.visible_text ?? 0) >= 0.8 ? readableText : [];
  const groundedIdentityText = groundedReadableText.filter((text) => ![description.brand_candidate, description.model_candidate].some(
    (identity) => identity && normalized(identity) === normalized(text),
  ));

  const textFirst = visibleTextFirst && readableText.length
    ? uniqueNonEmpty([
        description.brand_candidate,
        description.model_candidate,
        ...readableText.filter((text) => ![description.brand_candidate, description.model_candidate].some(
          (identity) => identity && normalized(identity) === normalized(text),
        )),
        type,
        description.color,
      ]).join(' ')
    : null;
  const variants = [textFirst || base.query];

  const identity = uniqueNonEmpty([
    description.brand_candidate,
    description.model_candidate,
    ...groundedIdentityText,
    type || description.subcategory,
  ]).join(' ');
  if (identity) variants.push(identity);

  // Strong, explicitly grounded readable identity evidence must survive
  // broadening. If we can reliably read markings such as a surname + jersey
  // number, do not fall back to a generic type/color query that can retrieve
  // visually similar but wrong identities.
  if (!groundedIdentityText.length) {
    const visual = uniqueNonEmpty([
      type || description.subcategory,
      description.color,
    ]).join(' ');
    if (visual) variants.push(visual);
  }

  return [...new Set(variants.map((query) => query.trim()).filter(Boolean))].slice(0, 3).map((query) => ({
    ...base,
    query,
  }));
}
