export type ProductPageMetadata = {
  sku: string | null;
  title: string | null;
  canonical_url: string | null;
  image_reference: string | null;
  price: string | null;
  currency: string | null;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function safeHttpUrl(value: string, base?: URL): URL | null {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host)
      || /^192\.168\./.test(host) || /^169\.254\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '::1') return null;
    return url;
  } catch {
    return null;
  }
}

function metaContent(html: string, names: string[]): string | null {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!key || !wanted.has(key)) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) return decodeHtml(content);
  }
  return null;
}

function canonicalHref(html: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (rel !== 'canonical') continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) return decodeHtml(href);
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function findProductJsonLd(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findProductJsonLd(item);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const type = record['@type'];
  const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  if (isProduct) return record;
  for (const child of Object.values(record)) {
    const hit = findProductJsonLd(child);
    if (hit) return hit;
  }
  return null;
}

function jsonLdProduct(html: string): Record<string, unknown> | null {
  const scripts = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const script of scripts) {
    const body = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    if (!body) continue;
    try {
      const hit = findProductJsonLd(JSON.parse(body));
      if (hit) return hit;
    } catch {}
  }
  return null;
}

function offerPrice(value: unknown): { price: string | null; currency: string | null } {
  if (!value) return { price: null, currency: null };
  const offers = Array.isArray(value) ? value : [value];
  for (const offer of offers) {
    if (!offer || typeof offer !== 'object') continue;
    const record = offer as Record<string, unknown>;
    const rawPrice = record.price ?? record.lowPrice ?? record.highPrice;
    const price = typeof rawPrice === 'number'
      ? String(rawPrice)
      : typeof rawPrice === 'string' && rawPrice.trim()
        ? rawPrice.trim()
        : null;
    const currency = asString(record.priceCurrency);
    if (price || currency) return { price, currency };
  }
  return { price: null, currency: null };
}

function firstImage(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = firstImage(item);
      if (image) return image;
    }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return asString(record.url) ?? asString(record.contentUrl);
  }
  return null;
}


function isShopifyHtml(html: string): boolean {
  return /cdn\.shopify\.com|shopify-section|\bShopify\b|window\.__st/i.test(html);
}

function shopifyLikelyHost(source: URL): boolean {
  const host = source.hostname.toLowerCase().replace(/^www\./, '');
  return host === 'kith.com'
    || host.endsWith('.myshopify.com');
}

function shopifyProductJsonUrl(source: URL): URL | null {
  if (!/\/products\/[^/?#]+/i.test(source.pathname)) return null;
  const url = new URL(source.toString());
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/$/, '') + '.js';
  return url;
}

function shopifyPrice(value: unknown): { price: string | null; currency: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { price: null, currency: null };
  const record = value as Record<string, unknown>;
  const raw = record.price_min ?? record.price;
  let price: string | null = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Shopify product JSON prices are integer minor units (for USD, cents).
    price = (raw / 100).toFixed(2);
  } else if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw);
    price = Number.isFinite(parsed) && /^\d+$/.test(raw.trim())
      ? (parsed / 100).toFixed(2)
      : raw.trim();
  }
  const currency = asString(record.currency) ?? null;
  return { price, currency };
}

async function fetchShopifyPrice(
  source: URL,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<{ price: string | null; currency: string | null }> {
  const productJsonUrl = shopifyProductJsonUrl(source);
  if (!productJsonUrl) return { price: null, currency: null };
  try {
    const response = await fetchImpl(productJsonUrl.toString(), {
      redirect: 'follow',
      signal,
      headers: { accept: 'application/json,text/javascript,*/*;q=0.8' },
    });
    if (!response.ok) return { price: null, currency: null };
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('json') && !contentType.includes('javascript')) return { price: null, currency: null };
    return shopifyPrice(await response.json());
  } catch {
    return { price: null, currency: null };
  }
}

export function extractProductPageMetadata(html: string, sourceUrl: string): ProductPageMetadata {
  const source = safeHttpUrl(sourceUrl);
  if (!source) return { sku: null, title: null, canonical_url: null, image_reference: null, price: null, currency: null };

  const product = jsonLdProduct(html);
  const sku = asString(product?.sku) ?? asString(product?.productID) ?? asString(product?.mpn);
  const title = asString(product?.name)
    ?? metaContent(html, ['og:title', 'twitter:title'])
    ?? null;

  const canonicalRaw = asString(product?.url)
    ?? canonicalHref(html)
    ?? metaContent(html, ['og:url', 'twitter:url']);
  const canonical = canonicalRaw ? safeHttpUrl(canonicalRaw, source) : source;
  const canonicalUrl = canonical && canonical.hostname === source.hostname ? canonical.toString() : source.toString();

  const imageRaw = firstImage(product?.image)
    ?? metaContent(html, ['og:image', 'og:image:secure_url', 'twitter:image']);
  const image = imageRaw ? safeHttpUrl(imageRaw, source) : null;
  const structuredOffer = offerPrice(product?.offers);
  const price = structuredOffer.price
    ?? metaContent(html, ['product:price:amount', 'og:price:amount', 'price'])
    ?? null;
  const currency = structuredOffer.currency
    ?? metaContent(html, ['product:price:currency', 'og:price:currency', 'priceCurrency'])
    ?? null;

  return {
    sku,
    title,
    canonical_url: canonicalUrl,
    image_reference: image?.toString() ?? null,
    price,
    currency,
  };
}

export async function fetchProductPageMetadata(
  destination: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2500,
): Promise<ProductPageMetadata> {
  const source = safeHttpUrl(destination);
  if (!source) return { sku: null, title: null, canonical_url: null, image_reference: null, price: null, currency: null };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Known Shopify merchants should use the lightweight product JSON endpoint
    // before downloading a potentially multi-megabyte storefront page.
    if (shopifyLikelyHost(source) && shopifyProductJsonUrl(source)) {
      const live = await fetchShopifyPrice(source, fetchImpl, controller.signal);
      if (live.price) {
        return {
          sku: null,
          title: null,
          canonical_url: source.toString(),
          image_reference: null,
          price: live.price,
          currency: live.currency ?? 'USD',
        };
      }
    }

    const response = await fetchImpl(source.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    const finalUrl = safeHttpUrl(response.url || source.toString()) ?? source;
    if (!response.ok || !(response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
      return { sku: null, title: null, canonical_url: finalUrl.toString(), image_reference: null, price: null, currency: null };
    }

    const reader = response.body?.getReader();
    if (!reader) return { sku: null, title: null, canonical_url: finalUrl.toString(), image_reference: null, price: null, currency: null };

    const decoder = new TextDecoder();
    let html = '';
    let bytes = 0;
    while (bytes < 2_500_000) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
    try { await reader.cancel(); } catch {}
    html += decoder.decode();
    const metadata = extractProductPageMetadata(html, finalUrl.toString());
    if (!metadata.price && shopifyProductJsonUrl(finalUrl) && (isShopifyHtml(html) || shopifyLikelyHost(finalUrl))) {
      const live = await fetchShopifyPrice(finalUrl, fetchImpl, controller.signal);
      return {
        ...metadata,
        price: live.price ?? metadata.price,
        currency: live.currency ?? metadata.currency ?? (live.price ? 'USD' : null),
      };
    }
    return metadata;
  } catch {
    return { sku: null, title: null, canonical_url: source.toString(), image_reference: null, price: null, currency: null };
  } finally {
    clearTimeout(timeout);
  }
}
