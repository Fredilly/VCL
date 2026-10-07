import { safeImageUrl } from './candidate-images.js';
import type { ProductPageMetadata } from './product-page-enrichment.js';
import { productType } from './verification-evidence.js';

/** Catalog metadata nominates a variant. It never verifies a video appearance. */
export type PartnerCatalogMetadata = ProductPageMetadata & {
  variant_id?: string | null;
  brand?: string | null;
  object_type?: string | null;
  family?: string | null;
  model?: string | null;
  color?: string | null;
  material?: string | null;
  resolution?: 'resolved' | 'ambiguous' | 'unavailable';
};

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
const string = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const named = (value: unknown): string | null => string(value) ?? string(record(value)?.name);
const typed = (value: RecordValue, type: string): boolean => list(value['@type']).some(item => item === type || item === `https://schema.org/${type}`);
const empty = (resolution: PartnerCatalogMetadata['resolution']): PartnerCatalogMetadata => ({
  sku: null, title: null, canonical_url: null, image_reference: null, price: null, currency: null, resolution,
});

// Keep all unknown query parameters. They may select a variant. Only known
// attribution parameters can be discarded, and URL paths remain case-sensitive.
export function catalogUrlKey(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    if (!safeImageUrl(url.href)) return null;
    const keys: string[] = [];
    url.searchParams.forEach((_value, key) => keys.push(key));
    for (const key of keys) if (/^(utm_.+|gclid|fbclid|msclkid|mkcid|mkevt|mkrid|campid|customid|campaign|affiliate|affid)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function imageUrl(value: unknown, source: string): string | null {
  for (const item of list(value)) {
    const raw = string(item) ?? string(record(item)?.url) ?? string(record(item)?.contentUrl);
    if (!raw) continue;
    try { const url = new URL(raw, source).href; if (safeImageUrl(url)) return url; } catch {}
  }
  return null;
}

function globalTradeId(product: RecordValue): string | null {
  for (const key of ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14']) {
    const value = string(product[key]);
    if (!value || !/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value) || /^0+$/.test(value)) continue;
    let sum = 0;
    for (let i = value.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) sum += Number(value[i]) * weight;
    if ((10 - sum % 10) % 10 === Number(value.at(-1))) return value.padStart(14, '0');
  }
  return null;
}

/** Select the linked variant, never the first Product or a group's hero image.
 * Supports inline ProductGroup.hasVariant and @graph/isVariantOf references.
 * See https://developers.google.com/search/docs/appearance/structured-data/product-variants
 */
export function extractPartnerCatalogMetadata(html: string, sourceUrl: string): PartnerCatalogMetadata {
  const source = catalogUrlKey(sourceUrl);
  if (!source) return empty('unavailable');
  const nodes: RecordValue[] = [];
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 20 || nodes.length >= 2000) return;
    if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1); return; }
    const node = record(value);
    if (!node) return;
    nodes.push(node);
    for (const child of Object.values(node)) if (typeof child === 'object') visit(child, depth + 1);
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* Invalid merchant markup is not identity evidence. */ }
  }
  const indexed = new Map(nodes.filter(node => string(node['@id']) && Object.keys(node).length > 1).map(node => [string(node['@id'])!, node]));
  const deref = (value: unknown): RecordValue | null => {
    const node = record(value);
    return node ? indexed.get(string(node['@id']) ?? '') ?? node : null;
  };
  const groups = nodes.filter(node => typed(node, 'ProductGroup'));
  const products = nodes.filter(node => typed(node, 'Product'));
  const rows = products.map(product => {
    const parent = deref(product.isVariantOf) ?? groups.find(group => list(group.hasVariant).some(value => deref(value) === product));
    // Inherit only genuinely shared attributes, never SKU, image or variant URL.
    const shared = parent ?? {};
    const offers = list(product.offers).map(deref).filter((offer): offer is RecordValue => Boolean(offer));
    const urls = [product.url, ...offers.map(offer => offer.url)].map(string).filter((url): url is string => Boolean(url));
    return { product, shared, offers, urls: urls.map(url => catalogUrlKey(url, source)).filter(Boolean) };
  });
  const matches = rows.filter(row => row.urls.includes(source));
  const hasSelector = Boolean(new URL(source).search);
  const eligible = matches.length ? matches : rows.length === 1 && !hasSelector
    && (!rows[0].urls.length || rows[0].urls.includes(source)) ? rows : [];
  // Repeated identical markup is harmless; inconsistent duplicates are ambiguous.
  const distinct = new Map(eligible.map(row => [JSON.stringify(row.product), row]));
  if (distinct.size !== 1) return empty(rows.length ? 'ambiguous' : 'unavailable');
  const { product, shared, offers } = [...distinct.values()][0];
  const sku = string(product.sku) ?? string(product.productID) ?? string(product.mpn);
  const brand = named(product.brand) ?? named(shared.brand);
  const color = named(product.color);
  const material = named(product.material) ?? named(shared.material);
  const size = named(product.size);
  const gtin = globalTradeId(product);
  // Auto-discovered merchant SKUs are local to a catalog. Only a validated GTIN
  // or an explicit operator catalog ID can merge identities across merchants.
  const variant = gtin ? `gtin:${gtin}` : sku
    ? `merchant:${new URL(source).hostname}:${sku}:${[color, size, material].map(value => value ?? '').join('|')}`
    : null;
  const offer = offers.find(row => catalogUrlKey(string(row.url) ?? source, source) === source) ?? offers[0];
  return {
    ...empty('resolved'), sku, variant_id: variant, brand,
    title: named(product.name) ?? named(shared.name),
    object_type: named(product.category) ?? named(shared.category) ?? productType(named(product.name) ?? named(shared.name) ?? ''),
    family: named(shared.productGroupID) ?? named(shared.name) ?? named(product.inProductGroupWithID),
    model: named(product.model) ?? named(shared.model), color, material,
    canonical_url: source, image_reference: imageUrl(product.image, source),
    price: offer && typeof offer.price === 'number' ? String(offer.price) : string(offer?.price),
    currency: string(offer?.priceCurrency),
  };
}

/** Read only the supplied public merchant URL, with bounded and validated hops.
 * No crawling, auth forwarding, script execution or alternate access paths.
 */
export async function fetchPartnerCatalogMetadata(destination: string, fetchImpl: typeof fetch = fetch): Promise<PartnerCatalogMetadata> {
  if (!safeImageUrl(destination)) return empty('unavailable');
  const signal = AbortSignal.timeout(5000);
  let url = destination;
  try {
    for (let hop = 0; hop <= 3; hop++) {
      const response = await fetchImpl(url, { redirect: 'manual', signal, headers: { accept: 'text/html,application/xhtml+xml' } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || hop === 3) return empty('unavailable');
        url = new URL(location, url).href;
        if (!safeImageUrl(url)) return empty('unavailable');
        continue;
      }
      if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') ?? '') || !response.body) {
        await response.body?.cancel();
        return empty('unavailable');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let html = '', bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2_500_000) { await reader.cancel(); return empty('unavailable'); }
        html += decoder.decode(value, { stream: true });
      }
      return extractPartnerCatalogMetadata(html + decoder.decode(), url);
    }
  } catch { /* Preserve unresolved links as errors at import, never guesses. */ }
  return empty('unavailable');
}
