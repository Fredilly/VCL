import type { CommerceProvider, ProductCandidate, ProductQuery } from './commerce.js';

type SerpApiShoppingResult = {
  product_id?: string;
  title?: string;
  product_link?: string;
  source?: string;
  price?: string;
  extracted_price?: number;
  thumbnail?: string;
};

type SerpApiShoppingResponse = {
  shopping_results?: SerpApiShoppingResult[];
  error?: string;
};

function classify(query: ProductQuery, title: string): 'LIKELY' | 'SIMILAR' {
  if (!query.brand || !query.model) return 'SIMILAR';
  const haystack = title.toLowerCase();
  return haystack.includes(query.brand.toLowerCase()) && haystack.includes(query.model.toLowerCase())
    ? 'LIKELY'
    : 'SIMILAR';
}

export class SerpApiCommerceProvider implements CommerceProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: ProductQuery): Promise<ProductCandidate[]> {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_shopping');
    url.searchParams.set('q', query.query);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('gl', 'us');
    url.searchParams.set('hl', 'en');

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`SerpAPI shopping search failed with HTTP ${response.status}`);
    }

    const payload = await response.json() as SerpApiShoppingResponse;
    if (payload.error) throw new Error(`SerpAPI shopping search failed: ${payload.error}`);

    return (payload.shopping_results ?? []).slice(0, 8).map((item): ProductCandidate => ({
      id: item.product_id ?? crypto.randomUUID(),
      title: item.title ?? '',
      brand: query.brand,
      model: query.model,
      category: query.subcategory || query.category || null,
      image_reference: item.thumbnail ?? null,
      provenance: item.source ? `serpapi:google-shopping:${item.source}` : 'serpapi:google-shopping',
      destination: item.product_link ?? null,
      price: typeof item.extracted_price === 'number' ? String(item.extracted_price) : item.price ?? null,
      currency: typeof item.extracted_price === 'number' ? 'USD' : null,
      result_class: classify(query, item.title ?? ''),
    }));
  }
}
