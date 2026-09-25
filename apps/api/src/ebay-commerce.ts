import {
  CommerceNoResultsError,
  CommerceProviderError,
  type CommerceProvider,
  type ProductCandidate,
  type ProductQuery,
} from './commerce.js';
import type { EbayAuth } from './ebay-auth.js';

type EbayItemSummary = {
  itemId?: string;
  title?: string;
  image?: { imageUrl?: string };
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  price?: { value?: string; currency?: string };
  categories?: Array<{ categoryName?: string }>;
  brand?: { brandName?: string };
  condition?: { conditionId?: string; condition?: string };
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number };
  shippingOptions?: Array<{ shippingCost?: { value?: string; currency?: string } }>;
  localizedAspects?: Array<{ name?: string; value?: string }>;
  additionalImages?: Array<{ imageUrl?: string }>;
};

type EbaySearchResponse = {
  itemSummaries?: EbayItemSummary[];
  total?: number;
  warnings?: Array<{ messageId?: string; message?: string }>;
};

function ebayModel(item: EbayItemSummary): string | null {
  const aspects = item.localizedAspects ?? [];
  const preferred = ['mpn', 'manufacturer part number', 'model', 'style code', 'sku'];
  for (const key of preferred) {
    const match = aspects.find((aspect) => aspect.name?.trim().toLowerCase() === key && aspect.value?.trim());
    if (match?.value) return match.value.trim();
  }
  return null;
}

function normalizeItem(item: EbayItemSummary, query: ProductQuery): ProductCandidate {
  const title = item.title ?? '';
  const model = ebayModel(item);
  const isLikely = Boolean(query.brand && query.model
    && title.toLowerCase().includes(query.brand.toLowerCase())
    && (title.toLowerCase().includes(query.model.toLowerCase()) || model?.toLowerCase() === query.model.toLowerCase()));

  return {
    id: item.itemId ?? crypto.randomUUID(),
    title,
    brand: item.brand?.brandName ?? null,
    model,
    category: item.categories?.[0]?.categoryName ?? null,
    metadata: { brand: item.brand?.brandName, model: model ?? undefined, category: item.categories?.[0]?.categoryName },
    image_reference: item.image?.imageUrl ?? item.additionalImages?.[0]?.imageUrl ?? null,
    provenance: 'ebay:browse',
    destination: item.itemAffiliateWebUrl ?? item.itemWebUrl ?? null,
    price: item.price?.value ?? null,
    currency: item.price?.currency ?? null,
    result_class: isLikely ? 'LIKELY' : 'SIMILAR',
    provider: 'ebay',
  };
}

export class EbayCommerceProvider implements CommerceProvider {
  private readonly timeoutMs: number;

  constructor(
    private readonly auth: EbayAuth,
    timeoutMs = 2500,
    private readonly affiliateCampaignId?: string,
  ) {
    this.timeoutMs = timeoutMs;
  }

  async search(query: ProductQuery): Promise<ProductCandidate[]> {
    const token = await this.auth.getAccessToken();
    const baseUrl = this.auth.getBrowseBaseUrl();
    const url = new URL('/buy/browse/v1/item_summary/search', baseUrl);
    url.searchParams.set('q', query.query);
    url.searchParams.set('limit', '12');

    return this.fetchItems(url, token, query, { method: 'GET' });
  }

  async getItemById(itemId: string, query: ProductQuery): Promise<ProductCandidate | null> {
    if (!itemId.trim()) return null;
    const token = await this.auth.getAccessToken();
    const baseUrl = this.auth.getBrowseBaseUrl();
    const url = new URL(`/buy/browse/v1/item/${encodeURIComponent(itemId.trim())}`, baseUrl);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    try {
      const item = await response.json() as EbayItemSummary;
      return item.title ? normalizeItem(item, query) : null;
    } catch {
      return null;
    }
  }

  async searchByImage(imageBase64: string, query: ProductQuery): Promise<ProductCandidate[]> {
    const token = await this.auth.getAccessToken();
    const baseUrl = this.auth.getBrowseBaseUrl();

    try {
      const url = new URL('/buy/browse/v1/item_summary/search_by_image', baseUrl);
      url.searchParams.set('limit', '12');

      return await this.fetchItems(url, token, query, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64 }),
      });
    } catch (error) {
      if (error instanceof CommerceProviderError || error instanceof CommerceNoResultsError) {
        return this.search(query);
      }
      throw error;
    }
  }

  private async fetchItems(
    url: URL,
    token: string,
    query: ProductQuery,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<ProductCandidate[]> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          ...(this.affiliateCampaignId && query.affiliate_reference_id
            ? { 'X-EBAY-C-ENDUSERCTX': `affiliateCampaignId=${this.affiliateCampaignId},affiliateReferenceId=${query.affiliate_reference_id}` }
            : {}),
          ...options.headers,
        },
        body: options.body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new CommerceProviderError(`eBay timed out after ${this.timeoutMs}ms.`);
      }
      throw new CommerceProviderError(error instanceof Error ? error.message : 'eBay request failed.');
    }

    if (!response.ok) {
      throw new CommerceProviderError(`eBay search failed with HTTP ${response.status}.`);
    }

    let payload: EbaySearchResponse;
    try {
      payload = await response.json() as EbaySearchResponse;
    } catch {
      throw new CommerceProviderError(`eBay returned invalid JSON with HTTP ${response.status}.`);
    }

    const items = (payload.itemSummaries ?? []).filter((item) => Boolean(item.title));
    if (items.length === 0) throw new CommerceNoResultsError('eBay returned no results.');

    return items.slice(0, 12).map((item) => normalizeItem(item, query));
  }
}
