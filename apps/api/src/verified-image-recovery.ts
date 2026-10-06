import type { VerifiedProductMapping } from './verified-product-mapping.js';

type BraveImageResult = {
  title?: string;
  url?: string;
  source?: string;
  thumbnail?: { src?: string };
  properties?: { url?: string; placeholder?: string };
};

type BraveImageResponse = {
  results?: BraveImageResult[];
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function safeHttp(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function samePage(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.hostname.toLowerCase() === b.hostname.toLowerCase()
      && a.pathname.replace(/\/$/, '').toLowerCase() === b.pathname.replace(/\/$/, '').toLowerCase();
  } catch {
    return false;
  }
}

function resultSupportsMapping(result: BraveImageResult, mapping: VerifiedProductMapping): boolean {
  if (result.url && samePage(result.url, mapping.destination)) return true;

  const title = normalizeText(result.title);
  const sku = normalizeText(mapping.product_id);
  const brand = normalizeText(mapping.brand);
  if (!sku || !title.includes(sku)) return false;
  if (brand && !title.includes(brand)) return false;
  return true;
}

export async function recoverVerifiedProductImage(
  apiKey: string | null | undefined,
  mapping: VerifiedProductMapping,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2200,
): Promise<string | null> {
  if (!apiKey || mapping.image_reference) return mapping.image_reference ?? null;

  const query = [mapping.product_id, mapping.brand, mapping.title]
    .filter(Boolean)
    .join(' ')
    .slice(0, 400);
  if (!query) return null;

  const url = new URL('https://api.search.brave.com/res/v1/images/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '12');
  url.searchParams.set('country', 'us');
  url.searchParams.set('search_lang', 'en');
  url.searchParams.set('safesearch', 'strict');
  url.searchParams.set('spellcheck', '0');

  try {
    const response = await fetchImpl(url.toString(), {
      headers: {
        'X-Subscription-Token': apiKey,
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const payload = await response.json() as BraveImageResponse;
    const supported = (payload.results ?? []).filter((result) => resultSupportsMapping(result, mapping));
    for (const result of supported) {
      const original = safeHttp(result.properties?.url);
      if (original) return original;
      const thumb = safeHttp(result.thumbnail?.src);
      if (thumb) return thumb;
      const placeholder = safeHttp(result.properties?.placeholder);
      if (placeholder) return placeholder;
    }
    return null;
  } catch {
    return null;
  }
}
