import { safeImageUrl } from './candidate-images.js';
import type { ProductCandidate, ProductQuery } from './commerce.js';
import type { PartnerCatalogMetadata } from './partner-catalog.js';
import type { RosterOfferInput } from './partner-learning.js';
import { productType } from './verification-evidence.js';

/**
 * Roster intake: turn whatever product list a partner sends for a video
 * (pasted description, chaotic notes, CSV/TSV export, JSON, bare links) into
 * reviewed, import-ready roster rows.
 *
 * Trust rules, same as the partner-roster importer:
 * - A row is READY only with an explicit SKU/GTIN, brand, title, object type,
 *   at least one purchasable offer and a reference image that actually loads.
 * - Search hits become offers only when their listing carries the same SKU/GTIN.
 *   A name-only lookalike is shown for review and never imported.
 * - SKUs inferred from search consensus are proposals for a human, never READY.
 * - Roster membership is candidate evidence. EXACT still requires the visual
 *   verifier on the selected frame.
 */

export type IntakeDefaults = {
  brand?: string | null;
  object_type?: string | null;
  platform?: string | null;
};

export type VideoRef = { platform: string; content_ref: string };

export type IntakeItem = {
  index: number;
  source_line: string;
  title: string | null;
  brand: string | null;
  sku: string | null;
  gtin: string | null;
  object_type: string | null;
  urls: string[];
  image_reference: string | null;
  price: string | null;
  timestamp_ms: number | null;
  candidate_window_start_ms?: number;
  candidate_window_end_ms?: number;
};

export type IntakeStatus = 'READY' | 'NEEDS_REVIEW' | 'UNRESOLVED';

export type IntakeOffer = {
  destination: string;
  source: 'partner_link' | 'sku_search';
  provider: string;
  title: string | null;
  price: string | null;
  currency: string | null;
  merchant_item_id: string | null;
};

export type ResolvedIntakeItem = IntakeItem & {
  status: IntakeStatus;
  reasons: string[];
  offers: IntakeOffer[];
  verified_image: string | null;
  fallback_images: string[];
  proposed_skus: Array<{ sku: string; support: number }>;
  /** partner = stated by the partner (may join sellers); merchant_page = read off one seller page (namespaced). */
  sku_source: 'partner' | 'merchant_page' | null;
  review_candidates: Array<{ title: string; destination: string; provider: string; price: string | null }>;
};

export type IntakeSearchHit = ProductCandidate & { provider?: string };

export type IntakeDependencies = {
  metadata(url: string): Promise<PartnerCatalogMetadata | null>;
  imageLoads(url: string): Promise<boolean>;
  search(query: ProductQuery): Promise<IntakeSearchHit[]>;
};

export const INTAKE_LIMITS = {
  maxItems: 100,
  maxResolveBatch: 8,
  maxLinksPerItem: 5,
  maxSearchOffers: 3,
  maxReviewCandidates: 5,
  lastWindowMs: 300_000,
  sourceLineChars: 400,
} as const;

const SOCIAL_HOSTS = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|twitter\.com|x\.com|facebook\.com|fb\.com|threads\.net|patreon\.com|discord\.gg|discord\.com|spotify\.com|soundcloud\.com|music\.apple\.com|epidemicsound\.com|artlist\.io|twitch\.tv|snapchat\.com|pinterest\.com|linkedin\.com|t\.me)$/i;
const IMAGE_PATH = /\.(?:jpe?g|png|webp|gif)$/i;
const URL_RE = /https?:\/\/[^\s<>"'`\])}]+/gi;
const TIME_RE = /(?:^|[\s[(])((?:\d{1,2}:)?\d{1,2}:\d{2})(?=$|[\s\])\-–—|,:])/;
// Currency symbols and ISO codes are deliberately broad: partners send lists
// from every market, and a price must never end up inside the product title.
const CURRENCY_CODE = 'USD|GBP|EUR|CAD|AUD|NZD|JPY|CNY|RMB|INR|KRW|BRL|MXN|SEK|NOK|DKK|CHF|PLN|TRY|AED|SAR|SGD|HKD|TWD|THB|IDR|MYR|PHP|VND|ZAR';
const CURRENCY_SYMBOL = '[$£€¥₹₩₽₺₫₴₦₱]';
// A long digit run before a currency ("98765432 ₹") is an article number, not
// a price. Suffix currencies only count with decimals or a short amount.
const PRICE_RE = new RegExp(
  `(?:${CURRENCY_SYMBOL}\\s?\\d[\\d.,]*`
  + `|\\b(?:${CURRENCY_CODE})\\s?\\d[\\d.,]*`
  + `|\\b\\d[\\d.,]*[.,]\\d{1,2}\\s?(?:${CURRENCY_CODE})\\b`
  + `|\\b\\d{1,6}\\s?(?:${CURRENCY_CODE})\\b`
  + `|\\b\\d[\\d.,]*[.,]\\d{1,2}\\s?${CURRENCY_SYMBOL}`
  + `|\\b\\d{1,6}\\s?${CURRENCY_SYMBOL})`,
  'i',
);
const LABELED_SKU_RE = /\b(?:sku|style(?:\s*(?:no\.?|number|code|#))?|item\s*(?:no\.?|number|#)|ref(?:erence)?(?:\s*(?:no\.?|#))?|model\s*(?:no\.?|number|#)|mpn|product\s*(?:code|id))\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9\-/.]{2,30})/i;
const GTIN_RE = /\b(?:gtin|upc|ean|barcode)\s*[:#]?\s*(\d{8,14})\b/i;
const BARE_GTIN_RE = /\b(\d{12,14})\b/;
// Plenty of brands use an all-digit article number instead of a letter+digit
// style code. 7-11 digits sits between "year/size" noise and a 12-14 digit GTIN.
const BARE_NUMERIC_SKU_RE = /\b(\d{7,11})\b/;
const BAG_WORDS = /\b(tote|pouch|clutch|hobo|bumbag|belt bag|crossbody|purse|satchel|duffle|duffel|keepall|speedy|neverfull|wallet on chain|shoulder bag|bucket bag|trunk)\b/i;

/**
 * Product types the shared evidence taxonomy does not model yet. Intake-local
 * only: this never changes how the visual verifier classifies evidence.
 * Checked after productType() so a "shirt" or "shoe" still wins on shared terms.
 */
const EXTRA_TYPE_WORDS: Array<[string, RegExp]> = [
  ['cap', /\b(cap|caps|hat|hats|beanie|beanies)\b/i],
  ['belt', /\b(belt|belts)\b/i],
  ['scarf', /\b(scarf|scarves|shawl|shawls)\b/i],
  ['tie', /\b(necktie|neckties|tie|ties)\b/i],
  ['gloves', /\b(glove|gloves|mitten|mittens)\b/i],
  ['socks', /\b(sock|socks)\b/i],
  ['wallet', /\b(wallet|wallets|cardholder|card holder|card case)\b/i],
  ['jewelry', /\b(jewelry|jewellery|necklace|necklaces|bracelet|bracelets|earring|earrings|pendant|pendants)\b/i],
  ['luggage', /\b(luggage|suitcase|suitcases|carry on|carry-on)\b/i],
  ['umbrella', /\b(umbrella|umbrellas)\b/i],
  ['phone case', /\b(phone case|phone cover|case for iphone)\b/i],
  ['chair', /\b(chair|chairs|armchair|armchairs|stool|stools)\b/i],
  ['table', /\b(table|tables|desk|desks)\b/i],
  ['sofa', /\b(sofa|sofas|couch|couches)\b/i],
  ['rug', /\b(rug|rugs|carpet|carpets)\b/i],
  ['poster', /\b(poster|posters|art print|art prints)\b/i],
  ['book', /\b(book|books|novel|novels)\b/i],
  ['toy', /\b(toy|toys|figure|figures)\b/i],
  ['headphones', /\b(headphone|headphones|earbuds|earphones|headset|headsets)\b/i],
  ['sneakers', /\b(sneaker|trainer|sandal|loafer|heel)\b/i],
  ['boots', /\b(boot)\b/i],
];

const ACCESSORY_TYPES = new Set([
  'bag', 'cap', 'belt', 'scarf', 'tie', 'gloves', 'socks', 'wallet', 'sunglasses',
  'watch', 'jewelry', 'luggage', 'umbrella', 'phone case', 'accessories',
]);

const HEADER_SYNONYMS: Record<string, string[]> = {
  title: ['title', 'name', 'product', 'product name', 'item', 'item name', 'description', 'product title'],
  sku: ['sku', 'style', 'style code', 'style number', 'style no', 'item number', 'item no', 'model number', 'model no', 'mpn', 'ref', 'reference', 'code', 'product code', 'product id', 'variant', 'variant id', 'article', 'article number'],
  gtin: ['gtin', 'upc', 'ean', 'barcode'],
  url: ['url', 'link', 'destination', 'product url', 'product link', 'seller', 'seller url', 'seller link', 'buy', 'buy link', 'shop', 'shop link', 'where to buy'],
  image: ['image', 'image url', 'image link', 'photo', 'picture', 'image reference', 'image_reference', 'thumbnail'],
  brand: ['brand', 'designer', 'maker', 'manufacturer', 'vendor'],
  object_type: ['type', 'category', 'object type', 'product type'],
  price: ['price', 'cost', 'rrp', 'msrp'],
  timestamp: ['timestamp', 'time', 'start', 'timecode', 'time code', 'appears at', 'chapter'],
};

const bounded = (value: string | null | undefined, max: number): string | null => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};

export function normalizeCode(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Does this text carry the exact SKU/GTIN as its own token (not a substring of a longer code)? */
export function textCarriesCode(text: string | null | undefined, code: string | null | undefined): boolean {
  const target = normalizeCode(code);
  if (target.length < 5 || !text) return false;
  const tokens = text.toUpperCase().split(/[^A-Z0-9\-/.]+/).map(normalizeCode).filter(Boolean);
  // Also consider adjacent pairs so "M46 197" or "KHMA050113 001" still match.
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === target) return true;
    if (i + 1 < tokens.length && tokens[i] + tokens[i + 1] === target) return true;
  }
  return false;
}

/** Product-code-looking tokens: letters and digits, written in capitals, 5-16 chars. */
export function codeTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;|()[\]{}"']+/)) {
    const token = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (token.length < 5 || token.length > 16) continue;
    if (token !== token.toUpperCase()) continue;
    if (!/[0-9]/.test(token) || !/[A-Z]/.test(token)) continue;
    if (!/^[A-Z0-9][A-Z0-9\-/.]*$/.test(token)) continue;
    if (/^\d+(?:[A-Z]{1,2})$/.test(token) && token.length <= 6) continue; // 1080P, 2026SS, 25CM
    out.push(token);
  }
  return [...new Set(out)];
}

export function parseTimestamp(value: string | null | undefined): number | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
  }
  const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [h, m, s] = [Number(match[1] ?? 0), Number(match[2]), Number(match[3])];
  if (m > 59 && match[1] || s > 59) return null;
  return ((h * 60 + m) * 60 + s) * 1000;
}

export function parseVideoRef(value: string, defaults: IntakeDefaults = {}): VideoRef {
  const raw = (value ?? '').trim();
  if (!raw) throw new Error('A video URL or ID is required');
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return { platform: 'youtube', content_ref: raw };
  let url: URL;
  try { url = new URL(raw); } catch {
    if (defaults.platform) return { platform: defaults.platform.trim().toLowerCase(), content_ref: raw };
    throw new Error('Video must be a YouTube URL/ID or a public URL');
  }
  const host = url.hostname.replace(/^www\.|^m\./, '').toLowerCase();
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return { platform: 'youtube', content_ref: id };
  }
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const v = url.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return { platform: 'youtube', content_ref: v };
    const [kind, id] = url.pathname.split('/').filter(Boolean);
    if (['shorts', 'embed', 'live', 'v'].includes(kind ?? '') && id && /^[A-Za-z0-9_-]{11}$/.test(id)) return { platform: 'youtube', content_ref: id };
  }
  return { platform: (defaults.platform ?? host).trim().toLowerCase(), content_ref: url.href };
}

function inferObjectType(text: string | null, fallback: string | null | undefined): string | null {
  if (text) {
    // Shared taxonomy first (shirt, shoes, dress...), then intake-local types
    // for categories it does not model (cap, scarf, furniture...), then the
    // handbag vocabulary as a last resort. No brand is assumed anywhere.
    const found = productType(text.toLowerCase());
    if (found) return found;
    for (const [type, words] of EXTRA_TYPE_WORDS) if (words.test(text)) return type;
    if (BAG_WORDS.test(text)) return 'bag';
  }
  return bounded(fallback, 100);
}

function isImageUrl(url: string): boolean {
  try { return IMAGE_PATH.test(new URL(url).pathname); } catch { return false; }
}

function isSocialUrl(url: string): boolean {
  try { return SOCIAL_HOSTS.test(new URL(url).hostname.toLowerCase()); } catch { return false; }
}

function cleanUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/, '');
}

function emptyItem(index: number, line: string): IntakeItem {
  return {
    index, source_line: line.slice(0, INTAKE_LIMITS.sourceLineChars), title: null, brand: null, sku: null, gtin: null,
    object_type: null, urls: [], image_reference: null, price: null, timestamp_ms: null,
  };
}

/** Parse one free-text line. Returns null for blank/separator/header/social-only lines. */
export function parseLine(line: string, index: number): { item: IntakeItem | null; continuation: boolean; ignored?: string } {
  const original = line.trim();
  if (!original || /^[-=_*#~.\s]+$/.test(original)) return { item: null, continuation: false };
  const item = emptyItem(index, original);
  let rest = original;

  const urls = (rest.match(URL_RE) ?? []).map(cleanUrl);
  rest = rest.replace(URL_RE, ' ');
  for (const url of urls) {
    if (isImageUrl(url)) { item.image_reference ??= url; continue; }
    if (isSocialUrl(url)) continue;
    if (!item.urls.includes(url)) item.urls.push(url);
  }

  const time = TIME_RE.exec(rest);
  if (time) {
    item.timestamp_ms = parseTimestamp(time[1]);
    rest = rest.replace(time[1], ' ');
  }
  const gtin = GTIN_RE.exec(rest);
  if (gtin) { item.gtin = gtin[1]; rest = rest.replace(gtin[0], ' '); }
  const labeled = LABELED_SKU_RE.exec(rest);
  if (labeled) { item.sku = labeled[1].replace(/[.,;:]+$/, ''); rest = rest.replace(labeled[0], ' '); }
  const price = PRICE_RE.exec(rest);
  if (price) { item.price = price[0].trim(); rest = rest.replace(price[0], ' '); }
  if (!item.gtin) {
    const bare = BARE_GTIN_RE.exec(rest);
    if (bare) { item.gtin = bare[1]; rest = rest.replace(bare[0], ' '); }
  }
  if (!item.sku) {
    const [code] = codeTokens(rest);
    if (code) { item.sku = code; rest = rest.replace(code, ' '); }
  }
  if (!item.sku && !item.gtin) {
    const numeric = BARE_NUMERIC_SKU_RE.exec(rest);
    if (numeric) { item.sku = numeric[1]; rest = rest.replace(numeric[0], ' '); }
  }

  rest = rest
    .replace(/^\s*(?:[-*•·>]+|\(?\d{1,3}[.)\]]|#\d+[.):]?)\s*/, '')
    .replace(/\s*[-–—|:,;/]+\s*$/g, '')
    .replace(/^\s*[-–—|:,;/]+\s*/g, '')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasTitle = /[A-Za-z].*[A-Za-z]/.test(rest);
  const hasData = Boolean(item.urls.length || item.sku || item.gtin || item.image_reference);
  if (!hasTitle && !hasData) {
    return urls.length ? { item: null, continuation: false, ignored: 'social_or_non_product_link' } : { item: null, continuation: false };
  }
  // "Shop the video:", "Links below" etc. are headings, not products.
  if (hasTitle && !hasData && !item.timestamp_ms && /:\s*$/.test(original)) return { item: null, continuation: false, ignored: 'heading' };
  if (hasTitle && !hasData && !item.timestamp_ms && urls.length) return { item: null, continuation: false, ignored: 'social_or_non_product_link' };
  item.title = hasTitle ? bounded(rest, 300) : null;
  return { item, continuation: !hasTitle && item.timestamp_ms === null };
}

function mergeContinuation(target: IntakeItem, extra: IntakeItem): void {
  for (const url of extra.urls) if (!target.urls.includes(url)) target.urls.push(url);
  target.sku ??= extra.sku;
  target.gtin ??= extra.gtin;
  target.image_reference ??= extra.image_reference;
  target.price ??= extra.price;
  target.source_line = `${target.source_line}\n${extra.source_line}`.slice(0, INTAKE_LIMITS.sourceLineChars);
}

function splitDelimited(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell.trim()) quoted = true;
    else if (char === delimiter) { cells.push(cell); cell = ''; }
    else cell += char;
  }
  cells.push(cell);
  return cells.map(value => value.trim());
}

function headerField(header: string): string | null {
  const key = header.toLowerCase().replace(/[_\-]+/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  for (const [field, names] of Object.entries(HEADER_SYNONYMS)) if (names.includes(key)) return field;
  if (/\b(urls?|links?)\b/.test(key)) return /image|photo|picture/.test(key) ? 'image' : 'url';
  if (/\bsku\b|style|\bmpn\b/.test(key)) return 'sku';
  return null;
}

function itemFromFields(fields: Record<string, string[]>, index: number, source: string): IntakeItem | null {
  const first = (name: string) => fields[name]?.find(value => value.trim())?.trim() ?? null;
  const item = emptyItem(index, source);
  const title = first('title');
  // Free-text cells may still hide links, codes or timestamps; reuse the line parser on them.
  const parsedTitle = title ? parseLine(title, index).item : null;
  item.title = parsedTitle?.title ?? bounded(title, 300);
  item.brand = bounded(first('brand'), 120);
  item.sku = bounded(first('sku'), 160) ?? parsedTitle?.sku ?? null;
  item.gtin = (first('gtin') ?? '').replace(/\D/g, '') || parsedTitle?.gtin || null;
  item.object_type = bounded(first('object_type'), 100);
  item.price = bounded(first('price'), 40) ?? parsedTitle?.price ?? null;
  item.timestamp_ms = parseTimestamp(first('timestamp')) ?? parsedTitle?.timestamp_ms ?? null;
  const image = first('image');
  item.image_reference = image && /^https?:\/\//i.test(image) ? cleanUrl(image) : parsedTitle?.image_reference ?? null;
  for (const value of [...(fields.url ?? []), ...(parsedTitle?.urls ?? [])]) {
    for (const url of (value.match(URL_RE) ?? []).map(cleanUrl)) {
      if (isImageUrl(url)) item.image_reference ??= url;
      else if (!isSocialUrl(url) && !item.urls.includes(url)) item.urls.push(url);
    }
  }
  if (!item.title && !item.sku && !item.gtin && !item.urls.length) return null;
  return item;
}

function parseDelimited(lines: string[], delimiter: string): IntakeItem[] {
  const headers = splitDelimited(lines[0], delimiter).map(headerField);
  const items: IntakeItem[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = splitDelimited(line, delimiter);
    const fields: Record<string, string[]> = {};
    headers.forEach((field, column) => { if (field && cells[column]) (fields[field] ??= []).push(cells[column]); });
    const item = itemFromFields(fields, items.length + 1, line);
    if (item) items.push(item);
  }
  return items;
}

const JSON_LIST_KEYS = ['products', 'items', 'offers', 'roster', 'skus', 'catalog', 'data', 'results'];

function jsonRows(container: Record<string, unknown>): unknown[] | null {
  for (const key of JSON_LIST_KEYS) {
    if (Array.isArray(container[key])) return container[key] as unknown[];
  }
  // Exports often wrap the list one level deeper: { data: { products: [...] } }.
  for (const key of JSON_LIST_KEYS) {
    const nested = container[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const rows = jsonRows(nested as Record<string, unknown>);
      if (rows) return rows;
    }
  }
  return null;
}

function parseJson(value: unknown): IntakeItem[] | null {
  const container = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const rows = Array.isArray(value) ? value : container ? jsonRows(container) : null;
  if (!rows) return null;
  const items: IntakeItem[] = [];
  for (const row of rows) {
    if (typeof row === 'string') {
      const parsed = parseLine(row, items.length + 1).item;
      if (parsed) items.push(parsed);
      continue;
    }
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const fields: Record<string, string[]> = {};
    for (const [key, raw] of Object.entries(row as Record<string, unknown>)) {
      const field = headerField(key);
      if (!field) continue;
      for (const entry of Array.isArray(raw) ? raw : [raw]) {
        const text = typeof entry === 'string' ? entry : typeof entry === 'number' ? String(entry) : entry && typeof entry === 'object' && typeof (entry as { url?: unknown }).url === 'string' ? (entry as { url: string }).url : null;
        if (text) (fields[field] ??= []).push(text);
      }
    }
    const item = itemFromFields(fields, items.length + 1, JSON.stringify(row));
    if (item) items.push(item);
  }
  return items;
}

function looksDelimited(firstLine: string): string | null {
  for (const delimiter of ['\t', ',', ';', '|']) {
    if (!firstLine.includes(delimiter)) continue;
    const headers = splitDelimited(firstLine, delimiter).map(headerField);
    const known = headers.filter(Boolean);
    if (known.length >= 2 && (known.includes('title') || known.includes('sku') || known.includes('url'))) return delimiter;
  }
  return null;
}

/**
 * A partner export with headers we don't recognise ("Produkt;Preis;Link") is
 * still readable as free text per row: links, codes and prices survive, only
 * the column semantics are lost. Detect that shape rather than dropping rows.
 */
function unknownDelimitedPlan(lines: string[]): { delimiter: string; skipHeader: boolean } | null {
  const first = lines.find(line => line.trim()) ?? '';
  const dataLines = lines.slice(lines.indexOf(first) + 1).filter(line => line.trim());
  if (!dataLines.length) return null;
  for (const delimiter of ['\t', ',', ';', '|']) {
    if (!first.includes(delimiter)) continue;
    const width = splitDelimited(first, delimiter).length;
    if (width < 2) continue;
    if (!dataLines.every(line => splitDelimited(line, delimiter).length === width)) continue;
    const headerish = splitDelimited(first, delimiter).every(cell =>
      cell.split(/\s+/).filter(Boolean).length <= 6
      && !/\d|https?:\/\/|[$£€¥₹₩₽₺₫₴₦₱]/i.test(cell));
    return { delimiter, skipHeader: headerish };
  }
  return null;
}

function parseTextLines(lines: string[], warnings: string[], delimiter?: string): IntakeItem[] {
  const items: IntakeItem[] = [];
  for (const line of lines) {
    // Delimited fallback: keep every cell as text so URLs/codes/prices are still
    // extracted even when the headers are unknown.
    const parsed = parseLine(delimiter ? splitDelimited(line, delimiter).join(' ') : line, items.length + 1);
    if (parsed.ignored === 'social_or_non_product_link') warnings.push(`Ignored non-product link line: ${line.trim().slice(0, 120)}`);
    if (!parsed.item) continue;
    const previous = items[items.length - 1];
    // A bare link/code line belongs to the named product above it; in a plain
    // dump of links every link is its own product.
    if (parsed.continuation && previous?.title) mergeContinuation(previous, parsed.item);
    else items.push(parsed.item);
  }
  return items;
}

const hasData = (item: IntakeItem) => Boolean(item.urls.length || item.sku || item.gtin || item.image_reference || typeof item.timestamp_ms === 'number');

function looksLikeListItem(line: string): boolean {
  return /^\s*(?:[-*•·>]+|\(?\d{1,3}[.)\]]|#\d+[.):]?)\s+\S/.test(line);
}

/** Chapter/intro rows ("0:00 Intro", "Giveaway") are not products. */
function isIntroTitle(item: IntakeItem): boolean {
  if (item.urls.length || item.sku || item.gtin || item.image_reference) return false;
  return /^(intro|outro|welcome|hey|hi|hello|what'?s up|subscribe|giveaway|music|disclaimer|about|chapters?|timestamps?)\b/i.test(item.title ?? '');
}

/**
 * Pasted descriptions open with a video title or intro ("TOP 10 BAGS!!").
 * When the list has structured product lines, name-only lines before the first
 * of them are preamble. A pure list of names (no data anywhere) is kept whole,
 * except for an intro line that sits directly above a numbered/bulleted list.
 */
function dropPreamble(items: IntakeItem[], warnings: string[]): IntakeItem[] {
  const warn = (item: IntakeItem) => warnings.push(`Treated as intro text, not a product: ${(item.title ?? '').slice(0, 120)}`);
  let rows = items;
  const dropLeadingIntroRows = () => {
    // Leading chapter rows ("0:00 Intro") carry a timestamp but no product data.
    while (rows.length > 1 && isIntroTitle(rows[0])) {
      warn(rows[0]);
      rows = rows.slice(1);
    }
  };
  dropLeadingIntroRows();
  const first = rows.findIndex(hasData);
  if (first > 0) {
    for (const item of rows.slice(0, first)) warn(item);
    rows = rows.slice(first);
    dropLeadingIntroRows();
    return rows;
  }
  // Name-only intro line directly above a numbered/bulleted list.
  let offset = 0;
  while (rows.length - offset > 1
    && !hasData(rows[offset])
    && !looksLikeListItem(rows[offset].source_line)
    && looksLikeListItem(rows[offset + 1].source_line)) {
    warn(rows[offset]);
    offset++;
  }
  return offset ? rows.slice(offset) : rows;
}

function linkKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`;
  } catch {
    return url.trim().replace(/\/$/, '');
  }
}

/** Order-preserving dedupe: the same SKU/GTIN, or the same first link, is one product. */
function dedupe(items: IntakeItem[]): IntakeItem[] {
  const seen = new Map<string, IntakeItem>();
  const out: IntakeItem[] = [];
  for (const item of items) {
    const key = item.sku ? `sku:${normalizeCode(item.sku)}`
      : item.gtin ? `gtin:${item.gtin}`
      : item.urls[0] ? `link:${linkKey(item.urls[0])}`
      : null;
    const existing = key ? seen.get(key) : undefined;
    if (existing) {
      mergeContinuation(existing, item);
      existing.title ??= item.title;
      if (existing.timestamp_ms === null) existing.timestamp_ms = item.timestamp_ms;
      continue;
    }
    if (key) seen.set(key, item);
    out.push(item);
  }
  return out.map((item, i) => ({ ...item, index: i + 1 }));
}

/**
 * Timestamps are discussion hints only. Each product's candidate window runs
 * until the next listed product's timestamp, never asserting on-screen truth.
 */
export function assignCandidateWindows(items: IntakeItem[]): IntakeItem[] {
  const starts = [...new Set(items.map(item => item.timestamp_ms).filter((ms): ms is number => typeof ms === 'number'))].sort((a, b) => a - b);
  return items.map(item => {
    if (typeof item.timestamp_ms !== 'number') return item;
    const next = starts.find(ms => ms > item.timestamp_ms!);
    return {
      ...item,
      candidate_window_start_ms: item.timestamp_ms,
      candidate_window_end_ms: next !== undefined ? next - 1 : item.timestamp_ms + INTAKE_LIMITS.lastWindowMs,
    };
  });
}

export function parseRosterIntake(input: unknown, defaults: IntakeDefaults = {}): { items: IntakeItem[]; warnings: string[] } {
  const warnings: string[] = [];
  let items: IntakeItem[] | null = null;

  if (typeof input !== 'string') items = parseJson(input);
  else {
    const text = input.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
    const trimmed = text.trim();
    if (/^[[{]/.test(trimmed)) {
      try { items = parseJson(JSON.parse(trimmed)); } catch { /* not JSON; fall through to text */ }
    }
    if (!items) {
      const lines = text.split('\n');
      const firstLine = lines.find(line => line.trim()) ?? '';
      const delimiter = looksDelimited(firstLine);
      if (delimiter) items = parseDelimited(lines.slice(lines.indexOf(firstLine)), delimiter);
      else {
        const plan = unknownDelimitedPlan(lines);
        const body = plan?.skipHeader ? lines.slice(lines.indexOf(firstLine) + 1) : lines;
        items = parseTextLines(body, warnings, plan?.delimiter);
      }
    }
  }
  if (!items) throw new Error('Could not read a product list from this input');
  items = dropPreamble(items, warnings);

  const withDefaults = items.map(item => ({
    ...item,
    brand: item.brand ?? bounded(defaults.brand, 120),
    object_type: item.object_type ? item.object_type.toLowerCase() : inferObjectType(item.title, defaults.object_type),
  }));
  const deduped = dedupe(withDefaults);
  if (deduped.length < withDefaults.length) warnings.push(`Merged ${withDefaults.length - deduped.length} duplicate SKU line(s)`);
  if (deduped.length > INTAKE_LIMITS.maxItems) throw new Error(`Too many products (${deduped.length}); split the list into ${INTAKE_LIMITS.maxItems}-item parts`);
  if (!deduped.length) throw new Error('No products found in this input');
  return { items: assignCandidateWindows(deduped), warnings };
}

function significantWords(text: string | null, brand: string | null): string[] {
  const brandWords = new Set(normalizeWords(brand));
  return normalizeWords(text).filter(word => word.length > 2 && !brandWords.has(word) && !STOP_WORDS.has(word));
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'bag', 'bags', 'new', 'authentic', 'auth', 'used', 'preowned', 'pre', 'owned', 'women', 'womens', 'men', 'mens']);

function normalizeWords(text: string | null | undefined): string[] {
  return (text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}

function titleOverlap(itemTitle: string | null, hitTitle: string, brand: string | null): number {
  const wanted = significantWords(itemTitle, brand);
  if (!wanted.length) return 0;
  const have = new Set(normalizeWords(hitTitle));
  return wanted.filter(word => have.has(word)).length / wanted.length;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; }
}

function buildIntakeQuery(item: IntakeItem): ProductQuery | null {
  const pieces = [item.brand, item.sku ?? item.gtin, item.title && item.brand ? item.title.replace(new RegExp(`^${item.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '') : item.title]
    .filter((piece): piece is string => Boolean(piece && piece.trim()));
  const query = [...new Set(pieces.map(piece => piece.trim()))].join(' ').slice(0, 200).trim();
  if (!query) return null;
  return {
    query,
    category: item.object_type && ACCESSORY_TYPES.has(item.object_type) ? 'accessories' : item.object_type ?? 'product',
    subcategory: item.object_type ?? 'product',
    brand: item.brand,
    model: item.sku ?? null,
    attributes: [],
  };
}

export async function resolveIntakeItem(item: IntakeItem, deps: IntakeDependencies): Promise<ResolvedIntakeItem> {
  const reasons: string[] = [];
  const offers: IntakeOffer[] = [];
  const imageCandidates: string[] = [];
  const reviewCandidates: ResolvedIntakeItem['review_candidates'] = [];
  const proposals = new Map<string, number>();
  const resolved: IntakeItem = { ...item, urls: [...item.urls] };
  if (resolved.image_reference) imageCandidates.push(resolved.image_reference);
  // Only a partner-stated SKU/GTIN may join offers across merchants. A code
  // read off one merchant's page stays namespaced to that merchant, exactly as
  // the partner-roster importer treats auto-discovered SKUs.
  let skuSource: 'partner' | 'merchant_page' | null = resolved.sku || resolved.gtin ? 'partner' : null;
  let pageCode: string | null = null;

  // 1. Seller links the partner supplied. Their catalog markup can fill gaps,
  //    but a page whose SKU contradicts the partner's SKU is never used.
  for (const url of resolved.urls.slice(0, INTAKE_LIMITS.maxLinksPerItem)) {
    if (!safeImageUrl(url)) { reasons.push(`link_not_public_https:${url.slice(0, 120)}`); continue; }
    const metadata = await deps.metadata(url).catch(() => null);
    const rawPageSku = metadata?.sku || null;
    if (skuSource === 'partner' && resolved.sku && rawPageSku && normalizeCode(rawPageSku) !== normalizeCode(resolved.sku)) {
      reasons.push(`link_sku_mismatch:${hostOf(url)} lists ${rawPageSku}, partner listed ${resolved.sku}`);
      continue;
    }
    if (metadata?.resolution === 'ambiguous' && !resolved.sku) reasons.push(`link_variant_ambiguous:${hostOf(url)}`);
    if (!resolved.sku && !resolved.gtin && metadata?.resolution !== 'ambiguous' && (metadata?.variant_id || rawPageSku)) {
      resolved.sku = metadata?.variant_id || rawPageSku;
      skuSource = 'merchant_page';
      pageCode = rawPageSku;
    }
    resolved.title ??= bounded(metadata?.title, 300);
    resolved.brand ??= bounded(metadata?.brand, 120);
    resolved.object_type ??= bounded(metadata?.object_type, 100) ?? inferObjectType(metadata?.title ?? null, null);
    if (metadata?.image_reference) imageCandidates.push(metadata.image_reference);
    offers.push({
      destination: url, source: 'partner_link', provider: hostOf(url),
      title: bounded(metadata?.title, 300), price: metadata?.price ?? resolved.price ?? null,
      currency: metadata?.currency ?? null, merchant_item_id: null,
    });
  }

  // 2. Marketplace search (eBay etc.) when we still lack an offer or an image.
  //    Only listings that carry the same SKU/GTIN count as this product.
  if (!offers.length || !imageCandidates.length) {
    const searchCode = skuSource === 'merchant_page' ? pageCode : resolved.sku;
    const query = buildIntakeQuery({ ...resolved, sku: searchCode });
    const hits = query ? await deps.search(query).catch(() => [] as IntakeSearchHit[]) : [];
    let searchOffers = 0;
    for (const hit of hits) {
      if (!hit.destination || !safeImageUrl(hit.destination)) continue;
      const haystack = `${hit.title} ${hit.id} ${hit.model ?? ''} ${hit.destination}`;
      const codeMatch = textCarriesCode(haystack, searchCode) || textCarriesCode(haystack, resolved.gtin);
      const provider = hit.provider || hit.provenance || hostOf(hit.destination);
      if (codeMatch && skuSource === 'merchant_page' && pageCode) {
        // Same code on another site, but the code came from one merchant's page,
        // not the partner: suggest confirming it rather than merging sellers.
        proposals.set(pageCode, (proposals.get(pageCode) ?? 1) + 1);
        if (reviewCandidates.length < INTAKE_LIMITS.maxReviewCandidates) reviewCandidates.push({ title: hit.title.slice(0, 200), destination: hit.destination, provider, price: hit.price });
        continue;
      }
      if (codeMatch) {
        if (hit.image_reference) imageCandidates.push(hit.image_reference);
        for (const extra of hit.image_references ?? []) imageCandidates.push(extra);
        if (searchOffers < INTAKE_LIMITS.maxSearchOffers && !offers.some(offer => offer.destination === hit.destination)) {
          offers.push({
            destination: hit.destination, source: 'sku_search', provider,
            title: bounded(hit.title, 300), price: hit.price, currency: hit.currency, merchant_item_id: hit.id || null,
          });
          searchOffers++;
        }
        continue;
      }
      if (reviewCandidates.length < INTAKE_LIMITS.maxReviewCandidates) {
        reviewCandidates.push({ title: hit.title.slice(0, 200), destination: hit.destination, provider, price: hit.price });
      }
      // No SKU from the partner: gather codes that independent listings of the
      // same named product agree on. These are proposals for a human only.
      if (!skuSource && titleOverlap(resolved.title, hit.title, resolved.brand) >= 0.6) {
        for (const code of codeTokens(hit.title)) proposals.set(code, (proposals.get(code) ?? 0) + 1);
      }
    }
  }

  // 3. A reference image that actually loads. Missing pixels are exactly why
  //    roster SKUs were silently skipped by the verifier before.
  const uniqueImages = [...new Set(imageCandidates.filter(url => safeImageUrl(url)))];
  let verifiedImage: string | null = null;
  for (const url of uniqueImages) {
    if (await deps.imageLoads(url).catch(() => false)) { verifiedImage = url; break; }
  }
  const fallbackImages = uniqueImages.filter(url => url !== verifiedImage).slice(0, 2);

  const proposedSkus = [...proposals.entries()]
    .filter(([, support]) => support >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([sku, support]) => ({ sku, support }));

  if (!resolved.sku && !resolved.gtin) reasons.push(proposedSkus.length ? 'sku_missing_proposal_needs_review' : 'sku_missing');
  if (!resolved.brand) reasons.push('brand_missing');
  if (!resolved.title) reasons.push('title_missing');
  if (!resolved.object_type) reasons.push('object_type_missing');
  if (!offers.length) reasons.push(reviewCandidates.length ? 'no_sku_matched_offer' : 'no_offer');
  if (!verifiedImage) reasons.push(uniqueImages.length ? 'image_unavailable' : 'image_missing');

  const status: IntakeStatus = !reasons.length ? 'READY'
    : offers.length || reviewCandidates.length || proposedSkus.length || resolved.sku || resolved.gtin ? 'NEEDS_REVIEW'
    : 'UNRESOLVED';

  return {
    ...resolved,
    status,
    reasons,
    offers,
    verified_image: verifiedImage,
    fallback_images: fallbackImages,
    proposed_skus: proposedSkus,
    sku_source: skuSource,
    review_candidates: reviewCandidates,
  };
}

export async function resolveRosterIntake(items: IntakeItem[], deps: IntakeDependencies): Promise<ResolvedIntakeItem[]> {
  if (items.length > INTAKE_LIMITS.maxResolveBatch) throw new Error(`Resolve at most ${INTAKE_LIMITS.maxResolveBatch} products per request`);
  const out: ResolvedIntakeItem[] = [];
  // Sequential on purpose: bounded edge subrequests and polite merchant/API load.
  for (const item of items) out.push(await resolveIntakeItem(item, deps));
  return out;
}

/** Import manifest for POST /partner-roster. Only READY rows; every offer of a SKU merges into one identity. */
export function buildRosterManifest(video: VideoRef, items: ResolvedIntakeItem[]): {
  platform: string; content_ref: string; offers: RosterOfferInput[];
} {
  const offers: RosterOfferInput[] = [];
  for (const item of items) {
    if (item.status !== 'READY' || !item.verified_image) continue;
    const sku = (item.sku ?? item.gtin)!;
    for (const offer of item.offers) {
      offers.push({
        destination: offer.destination,
        sku,
        title: item.title!,
        brand: item.brand!,
        object_type: item.object_type!,
        image_reference: item.verified_image,
        ...(offer.merchant_item_id ? { merchant_item_id: offer.merchant_item_id } : {}),
        ...(typeof item.candidate_window_start_ms === 'number' && typeof item.candidate_window_end_ms === 'number'
          ? { candidate_window_start_ms: item.candidate_window_start_ms, candidate_window_end_ms: item.candidate_window_end_ms }
          : {}),
      });
    }
  }
  return { platform: video.platform, content_ref: video.content_ref, offers };
}

export function summarizeIntake(items: ResolvedIntakeItem[]) {
  const count = (status: IntakeStatus) => items.filter(item => item.status === status).length;
  return {
    products: items.length,
    ready: count('READY'),
    needs_review: count('NEEDS_REVIEW'),
    unresolved: count('UNRESOLVED'),
    offers: items.reduce((sum, item) => sum + (item.status === 'READY' ? item.offers.length : 0), 0),
    partner_link_offers: items.reduce((sum, item) => sum + item.offers.filter(offer => offer.source === 'partner_link').length, 0),
    sku_search_offers: items.reduce((sum, item) => sum + item.offers.filter(offer => offer.source === 'sku_search').length, 0),
  };
}

function formatTime(ms: number | null | undefined): string {
  if (typeof ms !== 'number') return '';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const md = (value: string | null | undefined) => (value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

const REASON_TEXT: Record<string, string> = {
  sku_missing: 'No SKU / style code. Ask the partner for it, or add a seller link whose page lists it.',
  sku_missing_proposal_needs_review: 'No SKU from the partner. Marketplace listings agree on a likely code (see proposals); confirm before import.',
  brand_missing: 'Brand unknown. Pass --brand or add a brand column.',
  title_missing: 'No product name.',
  object_type_missing: 'Product type unknown (bag, shoes, shirt...). Pass --object-type or add a type column.',
  no_offer: 'No seller link and no marketplace listing carries this SKU.',
  no_sku_matched_offer: 'Marketplace results found, but none list this exact SKU. Lookalikes are shown for review only.',
  image_missing: 'No reference image found. The verifier cannot compare pixels without one.',
  image_unavailable: 'Reference images found but none could be downloaded.',
};

function reasonText(reason: string): string {
  const [code, detail] = reason.split(/:(.+)/);
  if (code === 'link_sku_mismatch') return `Seller page lists a different SKU (${detail}). Link not used.`;
  if (code === 'link_variant_ambiguous') return `Seller page (${detail}) covers several variants; give the exact SKU.`;
  if (code === 'link_not_public_https') return `Link is not a public https URL: ${detail}`;
  return REASON_TEXT[code] ?? reason;
}

/** "Products on a page": what to import, what to ask the partner for. */
export function renderIntakeReview(video: VideoRef, items: ResolvedIntakeItem[], warnings: string[] = []): string {
  const summary = summarizeIntake(items);
  const lines: string[] = [
    `# Roster intake: ${video.platform} ${video.content_ref}`,
    '',
    `**${summary.ready} of ${summary.products} products ready to import** (${summary.offers} offers). ${summary.needs_review} need review, ${summary.unresolved} unresolved.`,
    '',
    'READY rows have an explicit SKU, a purchasable offer and a reference image that loads. Importing them makes each SKU a roster candidate for this video; EXACT still requires the visual verifier on the viewer\'s frame.',
    '',
    '| # | Time | Status | Product | SKU | Offers | Image |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const item of items) {
    const offers = item.offers.map(offer => `[${md(offer.provider)}](${offer.destination})${offer.source === 'sku_search' ? ' (search)' : ''}`).join('<br>');
    const image = item.verified_image ? `[image](${item.verified_image})` : '—';
    const sku = item.sku_source === 'merchant_page' ? `${item.sku} (from seller page${item.proposed_skus.length ? `; confirm ${item.proposed_skus[0].sku}` : ''})`
      : item.sku ?? item.gtin ?? (item.proposed_skus.length ? `proposed: ${item.proposed_skus.map(p => p.sku).join(', ')}` : '—');
    lines.push(`| ${item.index} | ${formatTime(item.timestamp_ms)} | ${item.status} | ${md([item.brand, item.title].filter(Boolean).join(' — '))} | ${md(sku)} | ${offers || '—'} | ${image} |`);
  }
  const followUps = items.filter(item => item.status !== 'READY');
  if (followUps.length) {
    lines.push('', '## Needs attention', '');
    for (const item of followUps) {
      lines.push(`### ${item.index}. ${md(item.title ?? item.sku ?? 'Unnamed product')} — ${item.status}`, '');
      for (const reason of item.reasons) lines.push(`- ${reasonText(reason)}`);
      if (item.proposed_skus.length) lines.push(`- Proposed SKU(s): ${item.proposed_skus.map(p => `${p.sku} (${p.support} listings)`).join(', ')}`);
      if (item.review_candidates.length) {
        lines.push('- Lookalike listings (not imported):');
        for (const candidate of item.review_candidates) lines.push(`  - [${md(candidate.title)}](${candidate.destination}) — ${md(candidate.provider)}${candidate.price ? ` — ${md(candidate.price)}` : ''}`);
      }
      lines.push(`- Source: \`${md(item.source_line.split('\n')[0]).slice(0, 160)}\``, '');
    }
  }
  if (warnings.length) lines.push('', '## Parser notes', '', ...warnings.map(warning => `- ${md(warning)}`));
  return `${lines.join('\n')}\n`;
}
