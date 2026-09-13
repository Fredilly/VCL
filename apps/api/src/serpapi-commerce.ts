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
  snippet?: string;
};

type SerpApiShoppingResponse = {
  shopping_results?: SerpApiShoppingResult[];
  error?: string;
};

export type SerpApiQuotaInfo = {
  plan_searches_left?: number;
  total_searches_left?: number;
  this_month_usage?: number;
  searches_per_month?: number;
  account_rate_limit_per_hour?: number;
  this_hour_searches?: number;
};

const DEFAULT_TIMEOUT_MS = 2500;

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

function isQuotaExhaustedMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('run out of searches')
    || normalized.includes('rate limit exceeded')
    || normalized.includes('exceeded the hourly throughput limit');
}

export class SerpApiCommerceProvider implements CommerceProvider {
  private readonly timeoutMs: number;
  private quota: SerpApiQuotaInfo = {};
  private quotaExhausted = false;

  constructor(
    private readonly apiKey: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.timeoutMs = timeoutMs;
  }

  getQuotaInfo(): SerpApiQuotaInfo {
    return { ...this.quota };
  }

  isQuotaExhausted(): boolean {
    return this.quotaExhausted;
  }

  async search(query: ProductQuery): Promise<ProductCandidate[]> {
    if (this.quotaExhausted) {
      throw new CommerceProviderError('SerpAPI quota exhausted — skipping.');
    }

    await this.ensureQuotaFetched();

    if (this.quotaExhausted) {
      throw new CommerceProviderError('SerpAPI quota exhausted — skipping.');
    }

    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_shopping');
    url.searchParams.set('q', query.query);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('gl', 'us');
    url.searchParams.set('hl', 'en');

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new CommerceProviderError(`SerpAPI timed out after ${this.timeoutMs}ms.`);
      }
      throw new CommerceProviderError(error instanceof Error ? error.message : 'SerpAPI request failed.');
    }

    if (response.status === 429) {
      this.quotaExhausted = true;
      throw new CommerceProviderError('SerpAPI quota exhausted (HTTP 429).');
    }

    let payload: SerpApiShoppingResponse;
    try {
      payload = await response.json() as SerpApiShoppingResponse;
    } catch {
      throw new CommerceProviderError(`SerpAPI returned invalid JSON with HTTP ${response.status}.`);
    }

    if (payload.error && isQuotaExhaustedMessage(payload.error)) {
      this.quotaExhausted = true;
      throw new CommerceProviderError('SerpAPI quota exhausted.');
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

    return results.slice(0, 12).map((item): ProductCandidate => ({
      id: item.product_id ?? crypto.randomUUID(),
      title: item.title ?? '',
      brand: null,
      model: null,
      category: null,
      metadata: { description: item.snippet?.slice(0, 800) },
      image_reference: item.thumbnail ?? null,
      provenance: item.source ? `serpapi:google-shopping:${item.source}` : 'serpapi:google-shopping',
      destination: item.product_link ?? null,
      price: typeof item.extracted_price === 'number' ? String(item.extracted_price) : item.price ?? null,
      currency: typeof item.extracted_price === 'number' ? 'USD' : null,
      result_class: classify(query, item.title ?? ''),
      provider: 'serpapi',
    }));
  }

  private async ensureQuotaFetched(): Promise<void> {
    if (Object.keys(this.quota).length > 0) return;
    try {
      await this.fetchQuotaInfo();
    } catch {
      // Quota fetch is best-effort; proceed with search if it fails.
    }
  }

  private async fetchQuotaInfo(): Promise<void> {
    const url = new URL('https://serpapi.com/account.json');
    url.searchParams.set('api_key', this.apiKey);

    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) return;

    const data = await response.json() as Record<string, unknown>;
    this.quota = {
      plan_searches_left: typeof data.plan_searches_left === 'number' ? data.plan_searches_left : undefined,
      total_searches_left: typeof data.total_searches_left === 'number' ? data.total_searches_left : undefined,
      this_month_usage: typeof data.this_month_usage === 'number' ? data.this_month_usage : undefined,
      searches_per_month: typeof data.searches_per_month === 'number' ? data.searches_per_month : undefined,
      account_rate_limit_per_hour: typeof data.account_rate_limit_per_hour === 'number' ? data.account_rate_limit_per_hour : undefined,
      this_hour_searches: typeof data.this_hour_searches === 'number' ? data.this_hour_searches : undefined,
    };

    if (this.quota.total_searches_left !== undefined && this.quota.total_searches_left <= 0) {
      this.quotaExhausted = true;
    }
  }
}
