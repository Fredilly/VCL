import {
  CommerceNoResultsError,
  CommerceProviderError,
  type CommerceProvider,
  type ProductCandidate,
  type ProductQuery,
} from './commerce.js';

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

function isNoResultsMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("hasn't returned any results")
    || normalized.includes('no results')
    || normalized.includes('did not return any results');
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

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new CommerceProviderError(error instanceof Error ? error.message : 'SerpAPI request failed.');
    }

    let payload: SerpApiShoppingResponse;
    try {
      payload = await response.json() as SerpApiShoppingResponse;
    } catch {
      throw new CommerceProviderError(`SerpAPI returned invalid JSON with HTTP ${response.status}.`);
    }

    if (payload.error && isNoResultsMessage(payload.error)) {
      throw new CommerceNoResultsError(payload.error);
    }

    if (!response.ok) {
      throw new CommerceProviderError(`SerpAPI shopping search failed with HTTP ${response.status}.`);
    }

    if (payload.error) throw new CommerceProviderError(`SerpAPI shopping search failed: ${payload.error}`);

    const results = (payload.shopping_results ?? []).filter((item) => Boolean(item.title));
    if (results.length === 0) throw new CommerceNoResultsError();

    return results.slice(0, 8).map((item): ProductCandidate => ({
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
      provider: 'serpapi',
    }));
  }
}
