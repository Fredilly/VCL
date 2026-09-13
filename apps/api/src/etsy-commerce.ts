import {
  CommerceNoResultsError,
  CommerceProviderError,
  type CommerceProvider,
  type ProductCandidate,
  type ProductQuery,
} from './commerce.js';
import type { EtsyCredentials } from './etsy-credentials.js';

const DEFAULT_TIMEOUT_MS = 2500;
const FRESHNESS_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

type EtsyPrice = {
  amount?: string;
  divisor?: number;
  currency_code?: string;
};

type EtsyListingResult = {
  listing_id?: number;
  title?: string;
  url?: string;
  description?: string;
  price?: EtsyPrice;
  tags?: string[];
  materials?: string[];
  taxonomy_id?: number;
  created_timestamp?: number;
  updated_timestamp?: number;
  last_modified_timestamp?: number;
};

type EtsySearchResponse = {
  count?: number;
  results?: EtsyListingResult[];
};

type EtsyRateLimitInfo = {
  limitPerDay?: number;
  remainingToday?: number;
  limitPerSecond?: number;
  remainingThisSecond?: number;
};

const ELIGIBLE_CATEGORIES = new Set([
  'apparel',
  'shoes',
  'bags',
  'jewelry',
  'accessories',
  'vintage',
  'handmade',
]);

function isEligibleCategory(query: ProductQuery): boolean {
  const category = (query.category ?? '').toLowerCase();
  const subcategory = (query.subcategory ?? '').toLowerCase();
  if (ELIGIBLE_CATEGORIES.has(category)) return true;
  if (ELIGIBLE_CATEGORIES.has(subcategory)) return true;
  const text = `${category} ${subcategory} ${query.query}`.toLowerCase();
  for (const eligible of ELIGIBLE_CATEGORIES) {
    if (text.includes(eligible)) return true;
  }
  return false;
}

function parsePrice(price?: EtsyPrice): { price: string | null; currency: string | null } {
  if (!price || !price.amount) return { price: null, currency: null };
  const amount = parseInt(price.amount, 10);
  if (isNaN(amount)) return { price: null, currency: null };
  const divisor = price.divisor ?? 100;
  const value = (amount / divisor).toFixed(2);
  return { price: value, currency: price.currency_code ?? null };
}

function freshnessTimestamp(listing: EtsyListingResult): number | undefined {
  return listing.last_modified_timestamp ?? listing.updated_timestamp ?? listing.created_timestamp;
}

function normalizeListing(listing: EtsyListingResult, query: ProductQuery, fetchedAt: number): ProductCandidate | null {
  const title = (listing.title ?? '').trim();
  if (!title) return null;
  const { price, currency } = parsePrice(listing.price);
  const isLikely = Boolean(
    query.brand && query.model &&
    title.toLowerCase().includes(query.brand.toLowerCase()) &&
    title.toLowerCase().includes(query.model.toLowerCase()),
  );

  const ts = freshnessTimestamp(listing);
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) {
    return null;
  }
  const ageMs = fetchedAt - ts * 1000;
  if (ageMs > FRESHNESS_MAX_AGE_MS) {
    return null;
  }

  return {
    id: listing.listing_id != null ? String(listing.listing_id) : crypto.randomUUID(),
    title,
    brand: null,
    model: null,
    category: null,
    metadata: {
      description: listing.description?.slice(0, 800),
      category: listing.tags?.slice(0, 5).join(', '),
      material: listing.materials?.[0],
      freshness: `${fetchedAt}:${ts}`,
    },
    image_reference: null,
    provenance: 'etsy:listings',
    destination: listing.url ?? null,
    price,
    currency,
    result_class: isLikely ? 'LIKELY' : 'SIMILAR',
    provider: 'etsy',
  };
}

function parseRateLimitHeaders(headers: Headers): EtsyRateLimitInfo {
  return {
    limitPerDay: parseHeaderInt(headers, 'x-rate-limit-limit'),
    remainingToday: parseHeaderInt(headers, 'x-rate-limit-remaining'),
    limitPerSecond: parseHeaderInt(headers, 'x-limit-per-second'),
    remainingThisSecond: parseHeaderInt(headers, 'x-remaining-this-second'),
  };
}

function parseHeaderInt(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}

export class EtsyCommerceProvider implements CommerceProvider {
  private readonly timeoutMs: number;
  private rateLimit: EtsyRateLimitInfo = {};

  constructor(
    private readonly credentials: EtsyCredentials,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.timeoutMs = timeoutMs;
  }

  getRateLimitInfo(): EtsyRateLimitInfo {
    return { ...this.rateLimit };
  }

  async search(query: ProductQuery): Promise<ProductCandidate[]> {
    if (!isEligibleCategory(query)) {
      return [];
    }

    const apiKey = this.credentials.apiKey;
    const sharedSecret = this.credentials.sharedSecret;
    const xApiKey = `${apiKey}:${sharedSecret}`;

    const url = new URL('https://openapi.etsy.com/v3/application/listings/active');
    url.searchParams.set('keywords', query.query);
    url.searchParams.set('limit', '12');
    url.searchParams.set('sort_on', 'score');
    url.searchParams.set('is_safe', 'true');

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': xApiKey,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new CommerceProviderError(`Etsy timed out after ${this.timeoutMs}ms.`);
      }
      throw new CommerceProviderError(error instanceof Error ? error.message : 'Etsy request failed.');
    }

    this.rateLimit = parseRateLimitHeaders(response.headers);

    if (response.status === 429) {
      throw new CommerceProviderError('Etsy rate limit exceeded (HTTP 429).');
    }

    if (!response.ok) {
      throw new CommerceProviderError(`Etsy search failed with HTTP ${response.status}.`);
    }

    let payload: EtsySearchResponse;
    try {
      payload = await response.json() as EtsySearchResponse;
    } catch {
      throw new CommerceProviderError(`Etsy returned invalid JSON with HTTP ${response.status}.`);
    }

    const results = payload.results ?? [];
    if (results.length === 0) {
      throw new CommerceNoResultsError('Etsy returned no results.');
    }

    const fetchedAt = Date.now();
    const candidates = results
      .map((listing) => normalizeListing(listing, query, fetchedAt))
      .filter((c): c is ProductCandidate => c !== null);

    if (candidates.length === 0) {
      throw new CommerceNoResultsError('Etsy returned no valid candidates.');
    }

    return candidates.slice(0, 12);
  }
}
