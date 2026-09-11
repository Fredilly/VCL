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

export function buildProductQuery(description: ObjectDescription): ProductQuery {
  const parts = [
    description.brand_candidate,
    description.model_candidate,
    ...description.search_terms,
  ].filter((value): value is string => Boolean(value && value.trim()));

  const fallback = [
    description.color,
    description.material,
    ...description.style_attributes,
    description.subcategory || description.category,
  ].filter(Boolean).join(' ');

  const deduped = [...new Set(parts.map((part) => part.trim()))];
  const query = deduped.slice(0, 3).join(' ').trim() || fallback.trim();

  return {
    query,
    category: description.category,
    subcategory: description.subcategory,
    brand: description.brand_candidate,
    model: description.model_candidate,
    attributes: [description.color, description.material, ...description.style_attributes].filter(Boolean),
  };
}
