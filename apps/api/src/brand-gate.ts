import type { ObjectDescription } from './types.js';
import type { ProductCandidate } from './commerce.js';
import { applyAttributeInvariantGate } from './attribute-gate.js';

const STRONG_BRAND_IDENTITY_THRESHOLD = 0.8;

function normalize(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function brandTokens(value: string | null | undefined): string[] {
  return [...new Set(normalize(value).split(' ').filter((token) => token.length >= 3))];
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
  const invariantProducts = applyAttributeInvariantGate(description, products);
  const brand = description.brand_candidate;
  if (!brand || description.identity_confidence < STRONG_BRAND_IDENTITY_THRESHOLD) return invariantProducts;
  return invariantProducts.filter((product) => candidateMatchesBrand(product.title, brand));
}
