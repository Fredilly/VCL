import { safeImageUrl } from './candidate-images.js';
import type { ProductCandidate, ProductQuery } from './commerce.js';
import type { PartnerCatalogMetadata } from './partner-catalog.js';
import type { RosterOfferInput } from './partner-learning.js';
import {
  brandFromHeadings, coloursContradict, coloursIn, familyAnchors, familyName, groupVariantId, isGroupVariantId, linkEvidence,
  looksLikeOutline, namesOtherProduct, parseOutline, plainListText, shortHash, sizesIn, variantLabel, type RejectedLink,
} from './roster-outline.js';
import { productType } from './verification-evidence.js';

/**
 * Roster intake: turn whatever product list a partner sends for a video
 * (pasted description, chaotic notes, CSV/TSV export, JSON, bare links) into
 * reviewed, import-ready roster rows.
 *
 * Two shapes are read:
 * - flat lists, one product per line/row (descriptions, CSV, JSON, link dumps);
 * - outlines, where a numbered product family has variant notes and each note
 *   has seller links under it. There the roster row is the *variant*, and all
 *   links under the note are offers of that one variant (see roster-outline.ts).
 *
 * Trust rules, same as the partner-roster importer:
 * - A row is READY only with an identity (below), brand, title, object type,
 *   at least one live offer and a reference image that actually loads.
 * - Identity, strongest first: a SKU/GTIN the partner stated; a manufacturer
 *   code stated by every link of the variant; a seller page's own SKU (kept
 *   merchant-namespaced); or, for a variant the partner named and grouped
 *   without any code, a video-local variant id. A video-local id can never
 *   join another video or another seller's catalog.
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
  /** Outline lists only: the numbered family this variant sits under. */
  section?: number | null;
  family?: string | null;
  variant?: string | null;
  /** How the parser arrived at `sku`. Absent on flat lists (= stated by the partner). */
  sku_basis?: 'partner' | 'link' | 'partner_group';
  /** Manufacturer codes stated by individual links but not adopted as this row's SKU. */
  link_codes?: Array<{ code: string; url: string }>;
  /** Merchant listing id per link (FP-1991017, POSH-..., EBAY-...). */
  listing_ids?: Record<string, string>;
  /** partner_unsure | partner_could_not_find | variant_unstated */
  flags?: string[];
  /** Links set aside because they contradict the family or the variant. Never offers, never reference photos. */
  rejected_links?: RejectedLink[];
  /** What a seller page must not contradict: the family's model words, the variant's colours and size. */
  match?: { anchors: string[]; colors: string[]; size: string | null };
  /** The partner's own side remarks, kept verbatim for the reviewer. */
  remarks?: string[];
  /** Machine notes for the reviewer that do not block import. */
  hints?: string[];
};

export type SkuSource = 'partner' | 'link' | 'partner_group' | 'merchant_page';

export type IntakeStatus = 'READY' | 'NEEDS_REVIEW' | 'UNRESOLVED';

export type IntakeOffer = {
  destination: string;
  source: 'partner_link' | 'sku_search';
  provider: string;
  title: string | null;
  price: string | null;
  currency: string | null;
  merchant_item_id: string | null;
  /** What reading the seller page told us. `unread` = reachable or blocked, but no product markup. */
  page?: 'resolved' | 'ambiguous' | 'unread' | 'blocked' | 'unreachable';
  /**
   * in_stock: the seller's own page (or a live marketplace inventory API) says it can be bought now.
   * sold_out: the page says it cannot. unconfirmed: nothing said so either way (page blocked,
   * unreachable or without availability markup). Only in_stock is ever imported as an offer.
   */
  availability?: 'in_stock' | 'sold_out' | 'unconfirmed';
  /** The seller's own availability wording, as read. Null when the page stated none. */
  availability_stated?: string | null;
  /** This listing's own photo, when it loads. */
  image?: string | null;
  seller_sku?: string | null;
};

export type ResolvedIntakeItem = IntakeItem & {
  status: IntakeStatus;
  reasons: string[];
  offers: IntakeOffer[];
  verified_image: string | null;
  fallback_images: string[];
  proposed_skus: Array<{ sku: string; support: number; source?: 'partner_link' | 'listings' }>;
  /**
   * partner / link = stated by the partner or by every link they gave (may join sellers by code);
   * partner_group = video-local id for a variant the partner named without a code;
   * merchant_page = read off one seller page (namespaced).
   */
  sku_source: SkuSource | null;
  /** Reviewer notes that do not block import (mixed sizes, removed listings ...). */
  notes?: string[];
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
  maxLinksPerItem: 8,
  maxResolveLinks: 24,
  maxVerifiedImages: 3,
  maxImageAttempts: 6,
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
  // "S-lock style fasteners" and "SKU FOR this video" are prose: a labelled
  // code needs a digit, or an explicit "SKU: ABCDE" separator.
  if (labeled && (/\d/.test(labeled[1]) || /[:#]\s*[A-Za-z0-9]/.test(labeled[0]))) {
    item.sku = labeled[1].replace(/[.,;:]+$/, '');
    rest = rest.replace(labeled[0], ' ');
  }
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

/**
 * Outline list -> one roster row per variant the partner named. Every link
 * under a variant note is an offer of that variant; nothing here decides that
 * two listings match, the partner's grouping does.
 */
function itemsFromOutline(text: string, defaults: IntakeDefaults, video: VideoRef | null, warnings: string[]): { items: IntakeItem[]; video_url: string | null } {
  const draft = parseOutline(text, defaults.brand);
  const headingParse = new Map<string, IntakeItem | null>();
  const parsedHeading = (heading: string) => {
    if (!headingParse.has(heading)) headingParse.set(heading, parseLine(heading, 0).item);
    return headingParse.get(heading) ?? null;
  };
  const headingTitles = draft.groups.map(group => parsedHeading(group.heading)?.title ?? group.heading);
  const statedBrand = bounded(defaults.brand, 120);
  const brand = statedBrand ?? brandFromHeadings(headingTitles);
  if (!statedBrand && brand) warnings.push(`Brand read from the headings: ${brand}. Pass --brand to override.`);
  warnings.push(...draft.warnings);

  let scope = video?.content_ref ?? '';
  if (!scope && draft.video_url) { try { scope = parseVideoRef(draft.video_url, defaults).content_ref; } catch { /* keep empty */ } }
  if (!scope) scope = `L${shortHash(text)}`;

  const items: IntakeItem[] = [];
  for (const group of draft.groups) {
    const heading = parsedHeading(group.heading);
    const gap = group.flags.includes('partner_could_not_find');
    const note = group.note ? parseLine(group.note, 0).item : null;
    const family = familyName(heading?.title ?? group.heading, brand);
    const noteLabel = group.note ? variantLabel(note?.title ?? group.note, heading?.title ?? group.heading, brand).label : null;
    // Rows split out of one note keep the note's label and add the size/colour that tells them apart.
    const variant = group.split_from !== null ? group.variant : noteLabel;
    const item = emptyItem(items.length + 1, [group.heading, group.note].filter(Boolean).join(' / '));
    item.section = group.section;
    item.family = family;
    item.variant = variant;
    item.title = bounded(variant ? `${family} - ${variant}` : family, 300);
    item.brand = brand;
    item.object_type = inferObjectType(`${group.heading} ${group.note ?? ''}`, defaults.object_type);
    item.urls = group.links.map(link => link.url);
    item.image_reference = group.image_reference ?? note?.image_reference ?? null;
    item.price = note?.price ?? (group.note ? null : heading?.price ?? null);
    item.timestamp_ms = note?.timestamp_ms ?? heading?.timestamp_ms ?? null;
    item.gtin = note?.gtin ?? (group.note ? null : heading?.gtin ?? null);
    item.flags = [...new Set(group.flags)];
    if (group.rejected.length) item.rejected_links = group.rejected;
    item.match = { anchors: familyAnchors(heading?.title ?? group.heading, brand), colors: coloursIn(noteLabel ?? ''), size: group.size };
    item.remarks = group.remarks.map(remark => remark.slice(0, 300));
    item.listing_ids = Object.fromEntries(group.links.filter(link => link.listing_id).map(link => [link.url, link.listing_id!]));
    const hints: string[] = [];

    // Identity. A code the partner wrote next to the variant wins. Otherwise a
    // manufacturer code counts only when every link of the variant states the
    // same one; a code on some links is a suggestion for the reviewer.
    const stated = note?.sku ?? (group.note ? null : heading?.sku ?? null);
    const linkCodes = group.links.flatMap(link => link.codes.map(code => ({ code, url: link.url })));
    const distinct = [...new Set(linkCodes.map(entry => normalizeCode(entry.code)))];
    if (stated) { item.sku = stated; item.sku_basis = 'partner'; }
    else if (item.gtin) item.sku_basis = 'partner';
    else if (!gap && distinct.length === 1 && group.links.length > 0 && group.links.every(link => link.codes.length === 1)) {
      item.sku = linkCodes[0].code;
      item.sku_basis = 'link';
    } else {
      item.sku = groupVariantId(scope, group.section, family, variant);
      item.sku_basis = 'partner_group';
      if (linkCodes.length) item.link_codes = linkCodes;
      if (distinct.length > 1) hints.push(`codes_differ:${distinct.join(', ')}`);
    }
    if (group.split_from !== null) hints.push(`split_from:${group.split_from}`);
    for (const link of group.rejected) hints.push(`link_rejected:${link.merchant}: ${link.detail}`);
    if (group.search_pages.length) hints.push(`search_page_ignored:${group.search_pages.length}`);
    if (group.links.length > INTAKE_LIMITS.maxLinksPerItem) hints.push(`links_over_limit:${group.links.length}`);
    item.hints = hints;
    items.push(item);
  }
  return { items, video_url: draft.video_url };
}

export function parseRosterIntake(input: unknown, defaults: IntakeDefaults = {}, video: VideoRef | null = null): { items: IntakeItem[]; warnings: string[]; video_url: string | null; layout: 'outline' | 'flat' } {
  const warnings: string[] = [];
  let items: IntakeItem[] | null = null;
  let videoUrl: string | null = null;
  let layout: 'outline' | 'flat' = 'flat';

  if (typeof input !== 'string') items = parseJson(input);
  else {
    // JSON is tried on the untouched input: un-escaping Markdown would corrupt it.
    const rawTrimmed = input.replace(/^\uFEFF/, '').trim();
    if (/^[[{]/.test(rawTrimmed)) {
      try { items = parseJson(JSON.parse(rawTrimmed)); } catch { /* not JSON; fall through to text */ }
    }
    const text = plainListText(input);
    if (!items) {
      const lines = text.split('\n');
      const firstLine = lines.find(line => line.trim()) ?? '';
      const delimiter = looksDelimited(firstLine);
      if (delimiter) items = parseDelimited(lines.slice(lines.indexOf(firstLine)), delimiter);
      else if (looksLikeOutline(text)) {
        const outline = itemsFromOutline(text, defaults, video, warnings);
        items = outline.items;
        videoUrl = outline.video_url;
        layout = 'outline';
      } else {
        const plan = unknownDelimitedPlan(lines);
        const body = plan?.skipHeader ? lines.slice(lines.indexOf(firstLine) + 1) : lines;
        items = parseTextLines(body, warnings, plan?.delimiter);
      }
    }
  }
  if (!items) throw new Error('Could not read a product list from this input');
  if (layout === 'flat') items = dropPreamble(items, warnings);

  const withDefaults = items.map(item => ({
    ...item,
    brand: item.brand ?? bounded(defaults.brand, 120),
    object_type: item.object_type ? item.object_type.toLowerCase() : inferObjectType(item.title, defaults.object_type),
  }));
  const deduped = dedupe(withDefaults);
  if (deduped.length < withDefaults.length) warnings.push(`Merged ${withDefaults.length - deduped.length} duplicate SKU line(s)`);
  if (deduped.length > INTAKE_LIMITS.maxItems) throw new Error(`Too many products (${deduped.length}); split the list into ${INTAKE_LIMITS.maxItems}-item parts`);
  if (!deduped.length) throw new Error('No products found in this input');
  return { items: assignCandidateWindows(deduped), warnings, video_url: videoUrl, layout };
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

const SOLD_OUT = /sold\s*out|out\s*of\s*stock|discontinued/i;
// schema.org values that mean a buyer can complete a purchase now.
const IN_STOCK = /^(?:in\s*stock|instock|limited\s*availability|limitedavailability|online\s*only|onlineonly)$/i;
// Search providers that answer from live inventory: a hit is a listing on sale now.
// Web-search providers return pages, which says nothing about availability.
const LIVE_INVENTORY_PROVIDERS = new Set(['ebay']);

/**
 * What a seller's own page says against this row. A contradiction means the
 * link was filed under the wrong product or variant: it is not an offer and
 * its photo is not a reference.
 */
function pageContradiction(item: IntakeItem, metadata: PartnerCatalogMetadata | null): { reason: RejectedLink['reason']; detail: string } | null {
  if (!metadata) return null;
  const brand = normalizeWords(metadata.brand).join(' ');
  const wantedBrand = normalizeWords(item.brand).join(' ');
  if (brand && wantedBrand && !brand.includes(wantedBrand) && !wantedBrand.includes(brand)) {
    return { reason: 'brand_contradiction', detail: `page brand is ${metadata.brand}, list says ${item.brand}` };
  }
  const title = metadata.title ?? '';
  if (!title || !item.match) return null;
  if (namesOtherProduct(normalizeWords(title).filter(word => !normalizeWords(item.brand).includes(word)), item.match.anchors)) {
    return { reason: 'other_product', detail: `page title does not mention ${item.match.anchors.join(' / ')}` };
  }
  const stated = [...new Set([...coloursIn(title), ...coloursIn(metadata.color)])];
  if (coloursContradict(item.match.colors, stated)) {
    return { reason: 'colour_contradiction', detail: `variant is ${item.match.colors.join(' / ')}, page says ${stated.join(' / ')}` };
  }
  const sizes = sizesIn(title);
  if (item.match.size && sizes.length && !sizes.includes(item.match.size)) {
    return { reason: 'size_contradiction', detail: `variant is size ${item.match.size}, page says ${sizes.join(' / ')}` };
  }
  return null;
}

export async function resolveIntakeItem(item: IntakeItem, deps: IntakeDependencies): Promise<ResolvedIntakeItem> {
  const reasons: string[] = [];
  const notes: string[] = [...(item.hints ?? [])];
  const offers: IntakeOffer[] = [];
  const imageCandidates: string[] = [];
  const reviewCandidates: ResolvedIntakeItem['review_candidates'] = [];
  const proposals = new Map<string, number>();
  const resolved: IntakeItem = { ...item, urls: [...item.urls] };
  if (resolved.image_reference) imageCandidates.push(resolved.image_reference);
  // A code the partner stated (or that every link they gave states) may join
  // offers across merchants. A video-local variant id never searches or joins
  // by code: its only offers are the links the partner put under that variant.
  // A code read off one merchant's page stays namespaced to that merchant,
  // exactly as the partner-roster importer treats auto-discovered SKUs.
  const basis = item.sku_basis ?? (isGroupVariantId(resolved.sku) ? 'partner_group' : 'partner');
  let skuSource: SkuSource | null = resolved.sku || resolved.gtin ? basis : null;
  const grouped = skuSource === 'partner_group';
  let pageCode: string | null = null;
  let removedLinks = 0;
  const rejected: RejectedLink[] = [...(item.rejected_links ?? [])];

  // 1. Seller links the partner supplied. Their catalog markup can fill gaps,
  //    but a page whose SKU contradicts the partner's SKU is never used.
  for (const url of resolved.urls.slice(0, INTAKE_LIMITS.maxLinksPerItem)) {
    if (!safeImageUrl(url)) { reasons.push(`link_not_public_https:${url.slice(0, 120)}`); continue; }
    const metadata = await deps.metadata(url).catch(() => null);
    if (metadata?.http_status === 404 || metadata?.http_status === 410) {
      // The listing is gone. One-off resale links do this constantly; importing
      // them is how a roster ends up with offers nobody can buy.
      removedLinks++;
      notes.push(`link_removed:${hostOf(url)}`);
      continue;
    }
    const rawPageSku = metadata?.sku || null;
    const listingId = resolved.listing_ids?.[url] ?? linkEvidence(url).listing_id;
    const stockNumber = listingId ? listingId.replace(/^[A-Z]+-/, '') : null;
    // A reseller's page SKU is usually its own stock number (the id in its URL),
    // not a competing manufacturer code. That is not a contradiction.
    const ownStockNumber = Boolean(rawPageSku && stockNumber && normalizeCode(rawPageSku) === normalizeCode(stockNumber));
    if ((skuSource === 'partner' || skuSource === 'link') && resolved.sku && rawPageSku && !ownStockNumber
      && normalizeCode(rawPageSku) !== normalizeCode(resolved.sku) && !textCarriesCode(metadata?.title, resolved.sku)) {
      reasons.push(`link_sku_mismatch:${hostOf(url)} lists ${rawPageSku}, partner listed ${resolved.sku}`);
      continue;
    }
    const contradiction = pageContradiction(resolved, metadata);
    if (contradiction) {
      rejected.push({ url, merchant: hostOf(url), ...contradiction });
      notes.push(`link_rejected:${hostOf(url)}: ${contradiction.detail}`);
      continue;
    }
    if (metadata?.resolution === 'ambiguous' && !resolved.sku) reasons.push(`link_variant_ambiguous:${hostOf(url)}`);
    if (!resolved.sku && !resolved.gtin && metadata?.resolution !== 'ambiguous' && (metadata?.variant_id || rawPageSku)) {
      resolved.sku = metadata?.variant_id || rawPageSku;
      skuSource = 'merchant_page';
      pageCode = rawPageSku;
    }
    // Manufacturer codes in a listing's title are suggestions for the reviewer.
    if (grouped && metadata?.title) for (const code of codeTokens(metadata.title)) proposals.set(code, (proposals.get(code) ?? 0) + 1);
    resolved.title ??= bounded(metadata?.title, 300);
    resolved.brand ??= bounded(metadata?.brand, 120);
    resolved.object_type ??= bounded(metadata?.object_type, 100) ?? inferObjectType(metadata?.title ?? null, null);
    const pageImage = metadata?.image_reference && safeImageUrl(metadata.image_reference) ? metadata.image_reference : null;
    if (pageImage) imageCandidates.push(pageImage);
    // Availability has to be stated by the seller. A page we could not read, or
    // one that says nothing, is not evidence that the item can be bought.
    const stated = (metadata?.availability ?? '').trim();
    const availability: IntakeOffer['availability'] = SOLD_OUT.test(stated) ? 'sold_out'
      : metadata?.resolution === 'resolved' && IN_STOCK.test(stated) ? 'in_stock' : 'unconfirmed';
    if (availability === 'sold_out') notes.push(`offer_sold_out:${hostOf(url)}`);
    if (availability === 'unconfirmed') notes.push(`offer_unconfirmed:${hostOf(url)}`);
    const status = metadata?.http_status ?? null;
    offers.push({
      destination: url, source: 'partner_link', provider: hostOf(url),
      title: bounded(metadata?.title, 300), price: metadata?.price ?? resolved.price ?? null,
      currency: metadata?.currency ?? null, merchant_item_id: stockNumber,
      page: metadata?.resolution === 'resolved' ? 'resolved' : metadata?.resolution === 'ambiguous' ? 'ambiguous'
        : status === 0 ? 'unreachable' : status !== null && status >= 400 ? 'blocked' : 'unread',
      availability, availability_stated: stated.slice(0, 60) || null, image: pageImage, seller_sku: rawPageSku,
    });
  }
  const live = () => offers.filter(offer => offer.availability === 'in_stock');

  // 2. Marketplace search (eBay etc.) when we still lack a live offer or an image.
  //    Only listings that carry the same SKU/GTIN count as this product.
  if (!live().length || !imageCandidates.length) {
    const searchCode = skuSource === 'merchant_page' ? pageCode : grouped ? null : resolved.sku;
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
            availability: LIVE_INVENTORY_PROVIDERS.has(String(provider).toLowerCase()) ? 'in_stock' : 'unconfirmed',
          });
          searchOffers++;
        }
        continue;
      }
      if (reviewCandidates.length < INTAKE_LIMITS.maxReviewCandidates) {
        reviewCandidates.push({ title: hit.title.slice(0, 200), destination: hit.destination, provider, price: hit.price });
      }
      // No code from the partner: gather codes that independent listings of the
      // same named product agree on. These are proposals for a human only.
      if ((!skuSource || grouped) && titleOverlap(resolved.title, hit.title, resolved.brand) >= 0.6) {
        for (const code of codeTokens(hit.title)) proposals.set(code, (proposals.get(code) ?? 0) + 1);
      }
    }
  }

  // 3. Reference images that actually load. Missing pixels are exactly why
  //    roster SKUs were silently skipped by the verifier before. Several
  //    listings of one variant give the verifier several real photos of it.
  const uniqueImages = [...new Set(imageCandidates.filter(url => safeImageUrl(url)))];
  const loaded: string[] = [];
  for (const url of uniqueImages.slice(0, INTAKE_LIMITS.maxImageAttempts)) {
    if (loaded.length >= INTAKE_LIMITS.maxVerifiedImages) break;
    if (await deps.imageLoads(url).catch(() => false)) loaded.push(url);
  }
  const verifiedImage = loaded[0] ?? null;
  for (const offer of offers) if (offer.image && !loaded.includes(offer.image)) offer.image = null;
  const fallbackImages = uniqueImages.filter(url => url !== verifiedImage).slice(0, 2);

  const linkProposals = new Map<string, number>();
  for (const { code } of resolved.link_codes ?? []) linkProposals.set(code, (linkProposals.get(code) ?? 0) + 1);
  const proposedSkus: ResolvedIntakeItem['proposed_skus'] = [
    ...[...linkProposals.entries()].map(([sku, support]) => ({ sku, support, source: 'partner_link' as const })),
    ...[...proposals.entries()]
      .filter(([sku, support]) => support >= 2 && !linkProposals.has(sku))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([sku, support]) => ({ sku, support, source: 'listings' as const })),
  ].slice(0, 3);

  if (resolved.flags?.includes('partner_could_not_find')) reasons.push('partner_could_not_find');
  if (resolved.flags?.includes('partner_unsure')) reasons.push('partner_unsure');
  if (resolved.flags?.includes('variant_unstated')) reasons.push('variant_unstated');
  if (!resolved.sku && !resolved.gtin) reasons.push(proposedSkus.length ? 'sku_missing_proposal_needs_review' : 'sku_missing');
  if (!resolved.brand) reasons.push('brand_missing');
  if (!resolved.title) reasons.push('title_missing');
  if (!resolved.object_type) reasons.push('object_type_missing');
  if (!live().length) {
    reasons.push(offers.some(offer => offer.availability === 'unconfirmed') ? 'no_confirmed_offer'
      : offers.length ? 'offers_sold_out' : removedLinks ? 'links_removed'
      : rejected.length ? 'links_rejected' : reviewCandidates.length ? 'no_sku_matched_offer' : 'no_offer');
  }
  // Nothing answered at all: say that, rather than "no image", so the fix is obvious.
  const unreachable = offers.length > 0 && offers.every(offer => offer.page === 'unreachable');
  if (!verifiedImage) reasons.push(uniqueImages.length ? 'image_unavailable' : unreachable ? 'sellers_unreachable' : 'image_missing');

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
    notes,
    ...(rejected.length ? { rejected_links: rejected } : {}),
  };
}

/**
 * Structure-only result for a run that deliberately fetches nothing: the rows,
 * identities and links exactly as read from the list, all marked unchecked.
 * Never READY, so nothing unchecked can reach the importer.
 */
export function uncheckedIntakeItem(item: IntakeItem): ResolvedIntakeItem {
  const basis = item.sku_basis ?? (isGroupVariantId(item.sku) ? 'partner_group' : 'partner');
  const linkProposals = new Map<string, number>();
  for (const { code } of item.link_codes ?? []) linkProposals.set(code, (linkProposals.get(code) ?? 0) + 1);
  return {
    ...item,
    status: 'NEEDS_REVIEW',
    reasons: ['not_checked', ...(item.flags ?? []).filter(flag => flag === 'partner_could_not_find' || flag === 'partner_unsure' || flag === 'variant_unstated')],
    offers: item.urls.slice(0, INTAKE_LIMITS.maxLinksPerItem).map(url => ({
      destination: url, source: 'partner_link' as const, provider: hostOf(url), title: null, price: null, currency: null,
      merchant_item_id: (item.listing_ids?.[url] ?? '').replace(/^[A-Z]+-/, '') || null, page: 'unread' as const, availability: 'unconfirmed' as const,
    })),
    verified_image: null,
    fallback_images: [],
    proposed_skus: [...linkProposals.entries()].map(([sku, support]) => ({ sku, support, source: 'partner_link' as const })).slice(0, 3),
    sku_source: item.sku || item.gtin ? basis : null,
    review_candidates: [],
    notes: [...(item.hints ?? [])],
  };
}

export async function resolveRosterIntake(items: IntakeItem[], deps: IntakeDependencies): Promise<ResolvedIntakeItem[]> {
  if (items.length > INTAKE_LIMITS.maxResolveBatch) throw new Error(`Resolve at most ${INTAKE_LIMITS.maxResolveBatch} products per request`);
  // Every link is a seller-page read plus image reads; bound the whole request, not just the row count.
  const links = items.reduce((sum, item) => sum + Math.min(item.urls?.length ?? 0, INTAKE_LIMITS.maxLinksPerItem), 0);
  if (links > INTAKE_LIMITS.maxResolveLinks) throw new Error(`Resolve at most ${INTAKE_LIMITS.maxResolveLinks} seller links per request`);
  const out: ResolvedIntakeItem[] = [];
  // Sequential on purpose: bounded edge subrequests and polite merchant/API load.
  for (const item of items) out.push(await resolveIntakeItem(item, deps));
  return out;
}

/** Import manifest for POST /partner-roster. Only READY rows; every live offer of a variant merges into one identity. */
export function buildRosterManifest(video: VideoRef, items: ResolvedIntakeItem[]): {
  platform: string; content_ref: string; offers: RosterOfferInput[];
} {
  const offers: RosterOfferInput[] = [];
  for (const item of items) {
    if (item.status !== 'READY' || !item.verified_image) continue;
    const sku = (item.sku ?? item.gtin)!;
    for (const offer of item.offers) {
      if (offer.availability !== 'in_stock') continue;
      // A video-local id travels as a declared, scoped variant handle. It is
      // never sent in the `sku` field, so no importer can read it as a SKU.
      const videoLocal = item.sku_source === 'partner_group' || isGroupVariantId(sku);
      offers.push({
        destination: offer.destination,
        ...(videoLocal ? { variant_id: sku, identity_scope: 'video_local' as const } : { sku }),
        title: item.title!,
        brand: item.brand!,
        object_type: item.object_type!,
        ...(item.family ? { family: item.family } : {}),
        // One reference image per variant. The verifier budgets image fetches per
        // URL per candidate; several photos per variant starve the rest of a large roster.
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

const liveOffers = (item: ResolvedIntakeItem) => item.offers.filter(offer => offer.availability === 'in_stock');

export function summarizeIntake(items: ResolvedIntakeItem[]) {
  const count = (status: IntakeStatus) => items.filter(item => item.status === status).length;
  return {
    products: items.length,
    families: new Set(items.map(item => item.family).filter(Boolean)).size,
    ready: count('READY'),
    needs_review: count('NEEDS_REVIEW'),
    unresolved: count('UNRESOLVED'),
    offers: items.reduce((sum, item) => sum + (item.status === 'READY' ? liveOffers(item).length : 0), 0),
    partner_link_offers: items.reduce((sum, item) => sum + liveOffers(item).filter(offer => offer.source === 'partner_link').length, 0),
    sku_search_offers: items.reduce((sum, item) => sum + liveOffers(item).filter(offer => offer.source === 'sku_search').length, 0),
    video_local_identities: items.filter(item => item.sku_source === 'partner_group').length,
    partner_gaps: items.filter(item => item.flags?.includes('partner_could_not_find')).length,
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
  offers_sold_out: 'Every seller link the partner gave is marked sold out. Needs a live listing.',
  no_confirmed_offer: 'No seller page confirmed the item can be bought now (blocked, unreachable, or no availability stated). Not imported until one does.',
  links_rejected: 'Every link filed here contradicts the product or the variant. Needs a correct listing.',
  variant_unstated: 'These listings do not say which size/colour they are, and the note mixes several. Assign each to its variant (or state the size next to the link).',
  links_removed: 'Every seller link the partner gave has been taken down. Needs a live listing.',
  sellers_unreachable: 'None of the seller pages could be reached from where this ran, so there is no reference image yet. Re-run from another network or through the API.',
  image_missing: 'No reference image found. The verifier cannot compare pixels without one.',
  image_unavailable: 'Reference images found but none could be downloaded.',
  not_checked: 'Seller pages and images were not checked in this run.',
  partner_could_not_find: 'The partner could not find this variant online. It appears in the video but has no listing yet.',
  partner_unsure: 'The partner was not sure about a link here. Check it shows the right variant, then remove their note to import.',
};

const NOTE_TEXT: Record<string, (detail: string) => string> = {
  split_from: detail => `Split out of "${detail}": the links under that note mix sizes or colours, so each is its own variant.`,
  link_rejected: detail => `Link set aside, not used as offer or photo (${detail}).`,
  offer_unconfirmed: detail => `${detail} did not confirm availability; link not imported.`,
  codes_differ: detail => `Links state different manufacturer codes (${detail}), so no single code was adopted.`,
  search_page_ignored: detail => `${detail} search-results link ignored (not a product).`,
  links_over_limit: detail => `${detail} links listed; only the first ${INTAKE_LIMITS.maxLinksPerItem} are checked.`,
  link_removed: detail => `${detail} listing has been taken down; not imported.`,
  offer_sold_out: detail => `${detail} listing is sold out; its photo is still used as a reference, the link is not imported.`,
};

function reasonText(reason: string): string {
  const [code, detail] = reason.split(/:(.+)/);
  if (code === 'link_sku_mismatch') return `Seller page lists a different SKU (${detail}). Link not used.`;
  if (code === 'link_variant_ambiguous') return `Seller page (${detail}) covers several variants; give the exact SKU.`;
  if (code === 'link_not_public_https') return `Link is not a public https URL: ${detail}`;
  return REASON_TEXT[code] ?? reason;
}

function noteText(note: string): string {
  const [code, detail] = note.split(/:(.+)/);
  return NOTE_TEXT[code]?.(detail ?? '') ?? note;
}

function identityText(item: ResolvedIntakeItem): string {
  const suggestion = item.proposed_skus.length ? `; suggested ${item.proposed_skus.map(p => p.sku).join(', ')}` : '';
  if (item.sku_source === 'merchant_page') return `${item.sku} (from seller page${item.proposed_skus.length ? `; confirm ${item.proposed_skus[0].sku}` : ''})`;
  if (item.sku_source === 'partner_group') return `video-local${suggestion}`;
  if (item.sku_source === 'link') return `${item.sku} (from the partner's link)`;
  return item.sku ?? item.gtin ?? (item.proposed_skus.length ? `proposed: ${item.proposed_skus.map(p => p.sku).join(', ')}` : '—');
}

function offersText(item: ResolvedIntakeItem): string {
  const state = (offer: IntakeOffer) => offer.availability === 'in_stock' ? ' ✓' : offer.availability === 'sold_out' ? ' (sold out)' : ' (availability unconfirmed)';
  return item.offers.map(offer => `[${md(offer.provider)}](${offer.destination})${state(offer)}${offer.source === 'sku_search' ? ' (search)' : ''}`).join('<br>') || '—';
}

/** "Products on a page": what to import, what to ask the partner for. */
export function renderIntakeReview(video: VideoRef, items: ResolvedIntakeItem[], warnings: string[] = []): string {
  const summary = summarizeIntake(items);
  const outline = items.some(item => item.family);
  // A structure-only run says so once, instead of on every row.
  const unchecked = items.length > 0 && items.every(item => item.reasons.includes('not_checked'));
  const lines: string[] = [
    `# Roster intake: ${video.platform} ${video.content_ref}`,
    '',
    `**${summary.ready} of ${summary.products} ${outline ? 'variants' : 'products'} ready to import** (${summary.offers} offers${outline ? `, ${summary.families} product families` : ''}). ${summary.needs_review} need review, ${summary.unresolved} unresolved.`,
    '',
    'READY rows have an identity, a live offer and a reference image that loads. Importing them makes each one a roster candidate for this video; EXACT still requires the visual verifier on the viewer\'s frame.',
  ];
  if (unchecked) lines.push('', '**Structure only.** This run read the list but did not open any seller page or image, so nothing is READY yet. Run without `--parse-only` to check links and images.');
  if (summary.video_local_identities) {
    lines.push('', `${summary.video_local_identities} variant(s) have no manufacturer code, so they carry a **video-local** id: "the thing this partner calls X in this video". It joins only the links the partner listed under that variant, and never matches another video or catalog. Add a code next to the variant in the list to upgrade it.`);
  }
  if (outline) {
    const sections = new Map<string, ResolvedIntakeItem[]>();
    for (const item of items) {
      const key = `${item.section ?? ''}|${item.family ?? item.title ?? ''}`;
      sections.set(key, [...(sections.get(key) ?? []), item]);
    }
    for (const rows of sections.values()) {
      const [first] = rows;
      lines.push('', `## ${first.section != null ? `${first.section}. ` : ''}${md(first.family ?? first.title ?? 'Unnamed product')}${first.timestamp_ms != null ? ` (${formatTime(first.timestamp_ms)})` : ''}`, '',
        '| # | Variant | Status | Identity | Offers | Image |', '|---|---|---|---|---|---|');
      for (const item of rows) {
        const image = item.verified_image ? `[image](${item.verified_image})` : '—';
        lines.push(`| ${item.index} | ${md(item.variant ?? '(as titled)')} | ${item.status} | ${md(identityText(item))} | ${offersText(item)} | ${image} |`);
      }
    }
  } else {
    lines.push('', '| # | Time | Status | Product | SKU | Offers | Image |', '|---|---|---|---|---|---|---|');
    for (const item of items) {
      const image = item.verified_image ? `[image](${item.verified_image})` : '—';
      lines.push(`| ${item.index} | ${formatTime(item.timestamp_ms)} | ${item.status} | ${md([item.brand, item.title].filter(Boolean).join(' — '))} | ${md(identityText(item))} | ${offersText(item)} | ${image} |`);
    }
  }
  const shownReasons = (item: ResolvedIntakeItem) => item.reasons.filter(reason => !(unchecked && reason === 'not_checked'));
  const followUps = items.filter(item => unchecked
    ? shownReasons(item).length || item.notes?.length || item.remarks?.length || item.proposed_skus.length
    : item.status !== 'READY' || item.notes?.length);
  if (followUps.length) {
    lines.push('', '## Needs attention', '');
    for (const item of followUps) {
      lines.push(`### ${item.index}. ${md(item.title ?? item.sku ?? 'Unnamed product')} — ${item.status}`, '');
      for (const reason of shownReasons(item)) lines.push(`- ${reasonText(reason)}`);
      for (const note of item.notes ?? []) lines.push(`- Note: ${noteText(note)}`);
      for (const remark of item.remarks ?? []) lines.push(`- Partner wrote: "${md(remark).slice(0, 200)}"`);
      if (item.proposed_skus.length) lines.push(`- Suggested SKU(s), not applied: ${item.proposed_skus.map(p => `${p.sku} (${p.source === 'partner_link' ? `stated by ${p.support} of the partner's links` : `${p.support} listings`})`).join(', ')}`);
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

const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * The cleaned roster as a spreadsheet. Edit it (add a code, drop a link, fix a
 * name) and feed the CSV back into intake: what the sheet states wins.
 */
export function renderIntakeCsv(items: ResolvedIntakeItem[]): string {
  const header = ['section', 'family', 'variant label', 'title', 'brand', 'type', 'sku', 'identity basis', 'status', 'links', 'image', 'needs'];
  const rows = items.map(item => [
    item.section ?? '', item.family ?? '', item.variant ?? '', item.title ?? '', item.brand ?? '', item.object_type ?? '',
    item.sku ?? item.gtin ?? '', item.sku_source ?? '', item.status,
    // Every link still filed under this row, whatever its current availability:
    // the sheet is the partner's list, cleaned, not the import manifest.
    item.urls.join(' '),
    item.verified_image ?? '', item.reasons.map(reason => reason.split(':')[0]).join(' '),
  ]);
  return `${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\n')}\n`;
}
