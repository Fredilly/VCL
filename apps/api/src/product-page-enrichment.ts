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

function visiblePrice(html: string): { price: string | null; currency: string | null } {
  const compact = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const usd = compact.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
  if (usd?.[1]) return { price: usd[1].replace(/,/g, ''), currency: 'USD' };
  return { price: null, currency: null };
}

function likelyProductImage(html: string, source: URL, title: string | null, sku: string | null): string | null {
  const wanted = [title, sku].filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  const candidates = tags.map((tag) => {
    const alt = decodeHtml(tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? '').toLowerCase();
    const src = tag.match(/\b(?:src|data-src)\s*=\s*["']([^"']+)["']/i)?.[1]
      ?? tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i)?.[1]?.split(',')[0]?.trim().split(/\s+/)[0];
    if (!src || src.startsWith('data:')) return null;
    const url = safeHttpUrl(decodeHtml(src), source);
    if (!url) return null;
    const score = wanted.some((value) => alt.includes(value.toLowerCase())) ? 2
      : /product|zoom|handbag|bag|shoe|shirt|watch|dress|jacket/i.test(alt) ? 1
      : 0;
    return { url: url.toString(), score };
  }).filter((value): value is { url: string; score: number } => Boolean(value));
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.score ? candidates[0].url : null;
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

function shopifyProductHandle(source: URL): string | null {
  const match = source.pathname.match(/\/products\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function shopifyProductEndpoint(source: URL, extension: 'json' | 'js'): URL | null {
  const handle = shopifyProductHandle(source);
  if (!handle) return null;
  const url = new URL(source.origin);
  url.pathname = `/products/${encodeURIComponent(handle)}.${extension}`;
  return url;
}

function shopifyPrice(value: unknown): { price: string | null; currency: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { price: null, currency: null };
  const root = value as Record<string, unknown>;
  const record = root.product && typeof root.product === 'object' && !Array.isArray(root.product)
    ? root.product as Record<string, unknown>
    : root;

  const variants = Array.isArray(record.variants) ? record.variants : [];
  for (const variant of variants) {
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)) continue;
    const row = variant as Record<string, unknown>;
    const raw = row.price;
    const price = typeof raw === 'number'
      ? String(raw)
      : typeof raw === 'string' && raw.trim()
        ? raw.trim()
        : null;
    const currency = asString(row.price_currency) ?? asString(row.currency);
    if (price) return { price, currency };
  }

  const raw = record.price_min ?? record.price;
  let price: string | null = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Shopify .js prices use integer minor units.
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
  timeoutMs = 1400,
): Promise<{ price: string | null; currency: string | null }> {
  for (const extension of ['json', 'js'] as const) {
    const endpoint = shopifyProductEndpoint(source, extension);
    if (!endpoint) return { price: null, currency: null };
    try {
      const response = await fetchImpl(endpoint.toString(), {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json,text/javascript,*/*;q=0.8' },
      });
      if (!response.ok) continue;
      const text = await response.text();
      if (!text.trim()) continue;
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        continue;
      }
      const price = shopifyPrice(payload);
      if (price.price) return price;
    } catch {
      // Try the next Shopify endpoint, then fall through to HTML metadata.
    }
  }
  return { price: null, currency: null };
}

export function extractProductPageMetadata(html: string, sourceUrl: string): ProductPageMetadata {
  const source = safeHttpUrl(sourceUrl);
  if (!source) return { sku: null, title: null, canonical_url: null, image_reference: null, price: null, currency: null };

  const product = jsonLdProduct(html);
  const pathSku = source.pathname.split('/').filter(Boolean).at(-1) ?? '';
  const sku = asString(product?.sku) ?? asString(product?.productID) ?? asString(product?.mpn)
    ?? (/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9-]{4,20}$/.test(pathSku) ? pathSku : null);
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
  const fallbackImage = image?.toString() ?? likelyProductImage(html, source, title, sku);
  const structuredOffer = offerPrice(product?.offers);
  const visibleOffer = visiblePrice(html);
  const price = structuredOffer.price
    ?? metaContent(html, ['product:price:amount', 'og:price:amount', 'price'])
    ?? visibleOffer.price
    ?? null;
  const currency = structuredOffer.currency
    ?? metaContent(html, ['product:price:currency', 'og:price:currency', 'priceCurrency'])
    ?? visibleOffer.currency
    ?? null;

  return {
    sku,
    title,
    canonical_url: canonicalUrl,
    image_reference: fallbackImage,
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
    if (shopifyLikelyHost(source) && shopifyProductHandle(source)) {
      const live = await fetchShopifyPrice(source, fetchImpl);
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
    if (!metadata.price && shopifyProductHandle(finalUrl) && (isShopifyHtml(html) || shopifyLikelyHost(finalUrl))) {
      const live = await fetchShopifyPrice(finalUrl, fetchImpl);
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
