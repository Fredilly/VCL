import type { CommerceProvider, ProductCandidate, ProductQuery } from './commerce.js';

type EbaySearchResponse = {
  itemSummaries?: Array<{
    itemId?: string;
    title?: string;
    image?: { imageUrl?: string };
    itemWebUrl?: string;
    price?: { value?: string; currency?: string };
    categories?: Array<{ categoryName?: string }>;
  }>;
};

export class EbayCommerceProvider implements CommerceProvider {
  constructor(private readonly accessToken: string) {}

  async search(query: ProductQuery): Promise<ProductCandidate[]> {
    const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    url.searchParams.set('q', query.query);
    url.searchParams.set('limit', '8');

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });

    if (!response.ok) {
      throw new Error(`eBay search failed with HTTP ${response.status}`);
    }

    const payload = await response.json() as EbaySearchResponse;
    return (payload.itemSummaries ?? []).map((item): ProductCandidate => ({
      id: item.itemId ?? crypto.randomUUID(),
      title: item.title ?? '',
      brand: query.brand,
      model: query.model,
      category: item.categories?.[0]?.categoryName ?? (query.subcategory || query.category || null),
      image_reference: item.image?.imageUrl ?? null,
      provenance: 'ebay:browse',
      destination: item.itemWebUrl ?? null,
      price: item.price?.value ?? null,
      currency: item.price?.currency ?? null,
      result_class: query.brand && query.model ? 'LIKELY' : 'SIMILAR',
    }));
  }
}
