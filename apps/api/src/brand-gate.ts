import type { ObjectDescription } from './types.js';
import type { ProductCandidate } from './commerce.js';

const STRONG_BRAND_IDENTITY_THRESHOLD = 0.8;

function normalize(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function brandTokens(value: string | null | undefined): string[] {
  return [...new Set(normalize(value).split(' ').filter((token) => token.length >= 3))];
}

export function brandsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = brandTokens(a);
  const right = brandTokens(b);
  if (!left.length || !right.length) return true;

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const shared = left.filter((token) => rightSet.has(token)).length;

  // Allow concise/sub-brand observations such as "Kith" for "Kith & '47",
  // while requiring an actual shared brand token. Unrelated brands fail closed.
  return shared >= 1
    && (shared === leftSet.size || shared === rightSet.size);
}

export function candidateMatchesBrand(title: string, brand: string | null | undefined): boolean {
  const normalizedBrand = normalize(brand);
  const normalizedTitle = normalize(title);
  if (!normalizedBrand) return true;
  if (` ${normalizedTitle} `.includes(` ${normalizedBrand} `)) return true;

  const expected = brandTokens(brand);
  if (!expected.length) return false;
  const titleTokens = new Set(normalizedTitle.split(' '));
  const overlap = expected.filter((token) => titleTokens.has(token)).length;

  if (expected.length === 1) return overlap === 1;
  return overlap >= Math.ceil(expected.length * 0.6);
}

export function applyBrandGate(description: ObjectDescription, products: ProductCandidate[]): ProductCandidate[] {
  const brand = description.brand_candidate;
  if (!brand || description.identity_confidence < STRONG_BRAND_IDENTITY_THRESHOLD) return products;
  return products.filter((product) => candidateMatchesBrand(product.title, brand));
}
