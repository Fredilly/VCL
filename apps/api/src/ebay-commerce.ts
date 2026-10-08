import {
  CommerceNoResultsError,
  CommerceProviderError,
  type CommerceProvider,
  type ProductCandidate,
  type ProductQuery,
} from './commerce.js';
import type { EbayAuth } from './ebay-auth.js';
import {
  resolveChromeMerchantDestination,
  shouldRequestAffiliateTreatment,
  type AffiliateComplianceStatus,
} from './affiliate-compliance.js';

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

export function ebayItemIdForLiveLookup(savedItemId: string | null | undefined, destination?: string | null): string {
  const saved = (savedItemId ?? '').trim();

  // Browse REST IDs identify the exact purchasable variation. Never collapse
  // v1|listing|variation to the legacy parent /itm/ listing ID.
  if (saved.includes('|')) return saved;

  if (destination) {
    try {
      const url = new URL(destination);
      const match = url.pathname.match(/\/itm\/(?:[^/]+\/)?([^/?#]+)/i);
      if (match?.[1]) return decodeURIComponent(match[1]);
    } catch {}
  }

  return saved;
}


export function ebayDestinationForOffer(itemId: string | null | undefined, destination: string | null | undefined): string | null {
  if (!destination) return null;
  const id = (itemId ?? '').trim();
  const parts = id.split('|');
  const variationId = parts.length >= 3 && parts[2] && parts[2] !== '0' ? parts[2] : null;
  if (!variationId) return destination;

  try {
    const url = new URL(destination);
    // Bind the click target to the same purchasable variation whose Browse
    // itemId/price we expose. Preserve all affiliate/tracking parameters.
    url.searchParams.set('var', variationId);
    return url.toString();
  } catch {
    return destination;
  }
}

function normalizeItem(
  item: EbayItemSummary,
  query: ProductQuery,
  affiliateComplianceStatus: AffiliateComplianceStatus,
): ProductCandidate {
  const title = item.title ?? '';
  const model = ebayModel(item);
  return {
    id: item.itemId ?? crypto.randomUUID(),
    title,
    brand: item.brand?.brandName ?? null,
    model,
    category: item.categories?.[0]?.categoryName ?? null,
    metadata: { brand: item.brand?.brandName, model: model ?? undefined, category: item.categories?.[0]?.categoryName },
    image_reference: item.image?.imageUrl ?? item.additionalImages?.[0]?.imageUrl ?? null,
    provenance: 'ebay:browse',
    destination: ebayDestinationForOffer(item.itemId, resolveChromeMerchantDestination({
      plain_url: item.itemWebUrl ?? null,
      affiliate_url: item.itemAffiliateWebUrl ?? null,
      status: affiliateComplianceStatus,
    })),
    price: item.price?.value ?? null,
    currency: item.price?.currency ?? null,
    // Provider rank/title overlap is retrieval evidence, not identity proof.
    result_class: 'SIMILAR',
    relationship: 'SIMILAR',
    provider: 'ebay',
  };
}

export class EbayCommerceProvider implements CommerceProvider {
  private readonly timeoutMs: number;

  constructor(
    private readonly auth: EbayAuth,
    timeoutMs = 2500,
    private readonly affiliateCampaignId?: string,
    private readonly affiliateComplianceStatus: AffiliateComplianceStatus = 'DISABLED_IN_EXTENSION',
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
    const rawId = itemId.trim();
    if (!rawId) return null;
    const token = await this.auth.getAccessToken();
    const baseUrl = this.auth.getBrowseBaseUrl();

    const fetchItem = async (id: string): Promise<ProductCandidate | null> => {
      const url = new URL(`/buy/browse/v1/item/${encodeURIComponent(id)}`, baseUrl);
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
        return item.title ? normalizeItem(item, query, this.affiliateComplianceStatus) : null;
      } catch {
        return null;
      }
    };

    // Browse search returns REST item IDs such as v1|307197731843|607037825827.
    // Older verified mappings only retained the legacy listing ID from /itm/.
    // The item endpoint may not resolve that legacy ID directly, so first try
    // the supplied ID, then resolve its current REST ID through Browse search.
    const direct = await fetchItem(rawId);
    if (direct) return direct;
    if (!/^\d+$/.test(rawId)) return null;

    const searchUrl = new URL('/buy/browse/v1/item_summary/search', baseUrl);
    searchUrl.searchParams.set('q', rawId);
    searchUrl.searchParams.set('limit', '12');
    let response: Response;
    try {
      response = await fetch(searchUrl, {
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
      const payload = await response.json() as { itemSummaries?: EbayItemSummary[] };
      const match = (payload.itemSummaries ?? []).find((item) => {
        const id = String(item.itemId ?? '');
        return id === rawId || id.split('|').includes(rawId);
      });
      return match?.title ? normalizeItem(match, query, this.affiliateComplianceStatus) : null;
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
          ...(this.affiliateCampaignId
            && query.affiliate_reference_id
            && shouldRequestAffiliateTreatment(this.affiliateComplianceStatus)
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

    return items.slice(0, 12).map((item) => normalizeItem(item, query, this.affiliateComplianceStatus));
  }
}
