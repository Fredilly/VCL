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
    ?? metaContent(html, ['product:price:amount', 'og:price:amount'])
    ?? null;
  const currency = structuredOffer.currency
    ?? metaContent(html, ['product:price:currency', 'og:price:currency'])
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
    while (bytes < 800_000) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
    try { await reader.cancel(); } catch {}
    html += decoder.decode();
    return extractProductPageMetadata(html, finalUrl.toString());
  } catch {
    return { sku: null, title: null, canonical_url: source.toString(), image_reference: null, price: null, currency: null };
  } finally {
    clearTimeout(timeout);
  }
}
