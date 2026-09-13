import {
  CommerceNoResultsError,
  CommerceProviderError,
  type CommerceProvider,
  type ProductCandidate,
  type ProductQuery,
} from './commerce.js';

type BraveWebResult = {
  title?: string;
  url?: string;
  description?: string;
  meta_url?: {
    scheme?: string;
    netloc?: string;
    hostname?: string;
    path?: string;
  };
  profile?: {
    name?: string;
    url?: string;
    long_name?: string;
  };
  extra_snippets?: string[];
};

type BraveWebSearchResponse = {
  type?: string;
  query?: {
    original?: string;
  };
  web?: {
    type?: string;
    results?: BraveWebResult[];
  };
  mixed?: {
    type?: string;
    main?: Array<{ type?: string; index?: number }>;
  };
  infobox?: {
    type?: string;
    title?: string;
    url?: string;
    description?: string;
  };
};

type BraveQuotaInfo = {
  tokens_remaining?: number;
  tokens_limit?: number;
};

const DEFAULT_TIMEOUT_MS = 2500;

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function normalizeResult(result: BraveWebResult): ProductCandidate | null {
  const title = (result.title ?? '').trim();
  if (!title) return null;

  const destination = result.url ?? null;
  const domain = result.meta_url?.hostname?.replace(/^www\./, '') ?? extractDomain(destination ?? '') ?? null;
  const description = (result.description ?? '').replace(/<[^>]+>/g, '').trim();

  return {
    id: crypto.randomUUID(),
    title,
    brand: null,
    model: null,
    category: null,
    image_reference: null,
    provenance: 'brave:web-search',
    destination,
    price: null,
    currency: null,
    result_class: 'SIMILAR',
    metadata: {
      description: description?.slice(0, 800) || undefined,
      category: domain ?? undefined,
    },
    provider: 'brave',
  };
}

function parseQuotaHeaders(headers: Headers): BraveQuotaInfo {
  return {
    tokens_remaining: parseHeaderInt(headers, 'x-ratelimit-remaining'),
    tokens_limit: parseHeaderInt(headers, 'x-ratelimit-limit'),
  };
}

function parseHeaderInt(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}

export class BraveCommerceProvider implements CommerceProvider {
  private readonly timeoutMs: number;
  private quota: BraveQuotaInfo = {};

  constructor(
    private readonly apiKey: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.timeoutMs = timeoutMs;
  }

  getQuotaInfo(): BraveQuotaInfo {
    return { ...this.quota };
  }

  async search(query: ProductQuery): Promise<ProductCandidate[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query.query);
    url.searchParams.set('count', '12');
    url.searchParams.set('country', 'us');
    url.searchParams.set('search_lang', 'en');

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Subscription-Token': this.apiKey,
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new CommerceProviderError(`Brave Search timed out after ${this.timeoutMs}ms.`);
      }
      throw new CommerceProviderError(error instanceof Error ? error.message : 'Brave Search request failed.');
    }

    this.quota = parseQuotaHeaders(response.headers);

    if (response.status === 429) {
      throw new CommerceProviderError('Brave Search rate limit exceeded (HTTP 429).');
    }

    if (!response.ok) {
      throw new CommerceProviderError(`Brave Search failed with HTTP ${response.status}.`);
    }

    let payload: BraveWebSearchResponse;
    try {
      payload = await response.json() as BraveWebSearchResponse;
    } catch {
      throw new CommerceProviderError(`Brave Search returned invalid JSON with HTTP ${response.status}.`);
    }

    const results = (payload.web?.results ?? []).filter((item) => Boolean(item.title));
    if (results.length === 0) throw new CommerceNoResultsError('Brave Search returned no results.');

    const candidates = results
      .map((result) => normalizeResult(result))
      .filter((c): c is ProductCandidate => c !== null);

    if (candidates.length === 0) {
      throw new CommerceNoResultsError('Brave Search returned no valid candidates.');
    }

    return candidates.slice(0, 12);
  }
}
