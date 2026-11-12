/**
 * Outline reading for roster intake.
 *
 * Partners rarely send one product per line. The common hand-made shape is an
 * outline: a numbered product family, variant notes under it, and a pile of
 * seller links under each note:
 *
 *   3. Louis Vuitton Neverfull Tote
 *   Flower floral variant
 *   https://seller-a/...
 *   https://seller-b/...
 *   Monogram classic
 *   https://seller-c/...
 *
 * The unit a viewer clicks on is the *variant* (family + note), and every link
 * under the note is a place to buy that variant. This module reads that
 * structure and the identity evidence hidden in the links themselves. It never
 * fetches anything and never decides that two listings are the same product:
 * the partner's own grouping is the only thing that joins them.
 */

export type LinkEvidence = {
  /** Destination with tracking/search state removed; variant selectors survive. */
  url: string;
  merchant: string;
  /** The merchant's own id for this listing, when the URL states it. */
  listing_id: string | null;
  /** Manufacturer-style codes stated in the URL path (never from query strings). */
  codes: string[];
  /** Size words in the listing's own name (PM, MM, 25, 40 ...). */
  sizes: string[];
  /** Basic colour words in the listing's own name, normalised (grey, not gray). */
  colors: string[];
  /** Words of the listing's own name, when the URL carries a readable one. */
  name_words: string[];
};

export type RejectedLink = { url: string; merchant: string; reason: 'other_product' | 'colour_contradiction' | 'size_contradiction' | 'brand_contradiction'; detail: string };

export type OutlineGroup = {
  section: number | null;
  /** Heading text with its number removed, exactly as the partner wrote it. */
  heading: string;
  /** Variant note as written; null for links sitting directly under the heading. */
  note: string | null;
  /** Cleaned variant label ("black with gold buckles"); null for the default group. */
  variant: string | null;
  links: LinkEvidence[];
  /** Links the partner filed here whose own name contradicts the family or the variant note. Never offers. */
  rejected: RejectedLink[];
  /** Set on rows produced by splitting one note whose links mix sizes or colours. */
  size: string | null;
  split_from: string | null;
  image_reference: string | null;
  search_pages: string[];
  /** partner_unsure | partner_could_not_find */
  flags: string[];
  remarks: string[];
  source_line: number;
};

export type Outline = {
  video_url: string | null;
  groups: OutlineGroup[];
  warnings: string[];
};

const URL_RE = /https?:\/\/[^\s<>"'`\])}]+/gi;
const IMAGE_PATH = /\.(?:jpe?g|png|webp|gif)$/i;
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)$/i;
const SOCIAL_HOSTS = /(^|\.)(instagram\.com|twitter\.com|x\.com|facebook\.com|fb\.com|threads\.net|patreon\.com|discord\.gg|discord\.com|spotify\.com|soundcloud\.com|music\.apple\.com|epidemicsound\.com|artlist\.io|twitch\.tv|snapchat\.com|pinterest\.com|linkedin\.com|t\.me)$/i;
const TRACKING_PARAM = /^(utm_.+|mk(evt|cid|rid)|campid|customid|toolid|srsltid|gclid|fbclid|msclkid|ultra_crid|scid|itm(meta|prp)|_skw|hash|epid|campaign|affiliate|affid|country|currency)$/i;
const COULD_NOT_FIND = /couldn.?t find|could not find|can.?t find|cannot find|not found|unavailable|no link|nothing online/i;
const UNSURE = /not sure|unsure|didn.?t open|did not open|doesn.?t open|maybe|i think|\?\s*$/i;
const GENERIC_LABEL = /^(?:(?:another|a|an|the|one|other|weird|new|different|more)\s+)*(?:variants?|variations?|versions?|colou?rs?|colou?rways?|options?|styles?)$/i;
// "1. Name", "2) Name", "8 Name" (number typed without a dot), optionally after a chapter time.
const HEADING_RE = /^\s*(?:#{1,6}\s+)?((?:\d{1,2}:)?\d{1,2}:\d{2}\s+)?(?:\(?(\d{1,3})\s*[.)\]]\s*|(\d{1,3})\s+(?=[A-Z]))(\S.*)$/;
const MD_HEADING_RE = /^\s*#{1,6}\s+(\S.*)$/;
const SIZE_WORDS = /^(?:nano|mini|micro|bb|pm|mm|gm|xs|xl|small|medium|large|(?:1[5-9]|[2-5]\d|60))$/i;

const COLOURS = ['black', 'white', 'red', 'blue', 'green', 'yellow', 'pink', 'brown', 'beige', 'cream', 'grey', 'silver', 'gold', 'orange', 'purple', 'burgundy', 'tan', 'navy'];
// Words that say what kind of thing it is, or how it is made, rather than which
// model it is. They cannot tell two products apart, so they never anchor a family.
const GENERIC_WORDS = new Set([
  'bag', 'bags', 'handbag', 'handbags', 'tote', 'hobo', 'bucket', 'pouch', 'bumbag', 'clutch', 'satchel', 'crossbody',
  'shoulder', 'purse', 'wallet', 'chain', 'top', 'handle', 'boston', 'leather', 'canvas', 'calfskin', 'lambskin', 'suede',
  'monogram', 'version', 'variant', 'variation', 'for', 'men', 'mens', 'women', 'womens', 'with', 'and', 'the', 'new',
  'authentic', 'auth', 'used', 'preowned', 'style', 'size', ...COLOURS, 'gray',
]);

/** "bluish", "greyish", "gray", "silver1" -> the plain colour, or null. */
export function colourOf(word: string): string | null {
  const text = word.toLowerCase().replace(/\d+$/, '').replace(/^gray/, 'grey');
  for (const candidate of [text, text.replace(/(?:ish|y)$/, ''), `${text.replace(/ish$/, '')}e`, text.replace(/(.)\1ish$/, '$1')]) {
    if (COLOURS.includes(candidate)) return candidate;
  }
  return null;
}

export function coloursIn(text: string | null | undefined): string[] {
  return [...new Set(words(text ?? '').map(colourOf).filter((colour): colour is string => Boolean(colour)))];
}

export function sizesIn(text: string | null | undefined): string[] {
  return [...new Set((text ?? '').split(/[^A-Za-z0-9]+/).filter(word => SIZE_WORDS.test(word)).map(word => word.toUpperCase()))];
}

/** The words of a family heading that name the model: brand, type, material and colour words removed. */
export function familyAnchors(family: string, brand?: string | null): string[] {
  const brandWords = new Set(words(brand ?? ''));
  return [...new Set(words(family).filter(word => word.length > 2 && !brandWords.has(word) && !GENERIC_WORDS.has(word) && !/^\d+$/.test(word)))];
}

/** Does a listing name mention the family at all? Only judged when the name is readable (3+ words). */
export function namesOtherProduct(nameWords: string[], anchors: string[]): boolean {
  const readable = nameWords.filter(word => /[a-z]/.test(word) && word.length > 2);
  if (!anchors.length || readable.length < 3) return false;
  return !readable.some(word => anchors.some(anchor => word === anchor || (anchor.length > 3 && word.includes(anchor)) || (word.length > 3 && anchor.includes(word))));
}

/** Two stated colour sets contradict when both say something and share nothing. */
export function coloursContradict(wanted: string[], stated: string[]): boolean {
  return wanted.length > 0 && stated.length > 0 && !wanted.some(colour => stated.includes(colour));
}

/** Google Docs/Markdown exports escape punctuation and wrap links; undo both. */
export function plainListText(source: string): string {
  return source
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/\\([^A-Za-z0-9\s])/g, '$1')
    // [text](url): keep the visible text unless it is just the URL again.
    .replace(/\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g, (_all, text: string, url: string) => (
      /^https?:\/\//i.test(text.trim()) ? url : `${text} ${url}`
    ));
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

export function isSearchPageUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (/\/(search|sch|s)(\/|$)/i.test(url.pathname)) return true;
    return ['q', 'query', '_nkw', 'keyword', 'keywords', 'search'].some(key => url.searchParams.has(key));
  } catch { return false; }
}

/** The listing itself, without the search/tracking state the partner's browser added. */
export function canonicalOfferUrl(raw: string): string {
  const cleaned = raw.replace(/[.,;:!?]+$/, '');
  try {
    const url = new URL(cleaned);
    url.hash = '';
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (/(^|\.)ebay\.[a-z.]+$/.test(host)) {
      // The item id fully identifies an eBay listing.
      const item = /\/itm\/(?:[^/]+\/)?(\d{9,})/.exec(url.pathname);
      if (item) return `https://${url.hostname}/itm/${item[1]}`;
    }
    const keys: string[] = [];
    url.searchParams.forEach((_value, key) => keys.push(key));
    for (const key of keys) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return cleaned; }
}

/**
 * Per-brand shapes of manufacturer style codes. Only used to lift a code out
 * of a seller's URL slug ("...-CarryAll-MMM46197-..."); a brand that is not
 * listed still gets codes that stand alone as a path segment.
 */
const BRAND_CODE_PATTERNS: Array<{ brand: RegExp; code: RegExp }> = [
  { brand: /louis\s*vuitton|\blv\b/i, code: /(?<![0-9])([MN][0-9]{5}|M[0-9][A-Z][0-9]{3})(?![0-9])/g },
  { brand: /nike|jordan/i, code: /(?<![A-Z0-9])([A-Z]{2}[0-9]{4}-[0-9]{3})(?![0-9])/g },
];

const MERCHANT_LISTING_IDS: Array<{ host: RegExp; id: RegExp; prefix: string }> = [
  { host: /(^|\.)fashionphile\.com$/, id: /\/products\/[^/]*?-(\d{5,9})\/?$/, prefix: 'FP' },
  { host: /(^|\.)poshmark\.[a-z.]+$/, id: /\/listing\/[^/]*?-([0-9a-f]{24})\/?$/, prefix: 'POSH' },
  { host: /(^|\.)ebay\.[a-z.]+$/, id: /\/itm\/(?:[^/]+\/)?(\d{9,})/, prefix: 'EBAY' },
  { host: /(^|\.)mercari\.com$/, id: /\/item\/(m\d{6,})/, prefix: 'MERCARI' },
];

/** Identity evidence a seller link states about itself. Path only: never query strings. */
export function linkEvidence(raw: string, brand?: string | null): LinkEvidence {
  const url = canonicalOfferUrl(raw);
  const merchant = hostOf(url);
  let path = '';
  try { path = decodeURIComponent(new URL(url).pathname); } catch { /* keep empty */ }
  let listingId: string | null = null;
  for (const rule of MERCHANT_LISTING_IDS) {
    if (!rule.host.test(merchant)) continue;
    const match = rule.id.exec(path);
    if (match) listingId = `${rule.prefix}-${match[1]}`;
    break;
  }
  const codes = new Set<string>();
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  // A final path segment that is nothing but a code: brand sites end product
  // URLs this way (/products/.../M28392, /t/.../II5381-417).
  if (/^[A-Za-z0-9][A-Za-z0-9-]{4,15}$/.test(last) && /[0-9]/.test(last) && /[A-Za-z]/.test(last)
    && last === last.toUpperCase() && !/^\d+[A-Z]{1,2}$/.test(last)) codes.add(last);
  const hints = `${brand ?? ''} ${merchant} ${path}`;
  for (const rule of BRAND_CODE_PATTERNS) {
    if (!rule.brand.test(hints)) continue;
    for (const match of path.toUpperCase().matchAll(rule.code)) codes.add(match[1]);
  }
  // Only a slug with letters is a name; an item number or hex id says nothing.
  const name = /[A-Za-z]{3,}[-_ ]+[A-Za-z]{3,}/.test(last) ? last.replace(/-[0-9a-f]{24}$/i, '').replace(/-\d{5,}$/, '') : '';
  return { url, merchant, listing_id: listingId, codes: [...codes], sizes: sizesIn(name), colors: coloursIn(name), name_words: words(name) };
}

/**
 * `previous` is the last heading number seen. A number typed without a dot
 * ("8 Vanity Chain Pouch") only counts as a heading when it continues the
 * sequence, so a note such as "25 Monogram version" stays a note.
 */
function headingOf(line: string, previous: number | null): { number: number | null; text: string } | null {
  const numbered = HEADING_RE.exec(line);
  if (numbered) {
    const number = Number(numbered[2] ?? numbered[3]);
    const loose = numbered[2] === undefined;
    // A chapter time in front of the number stays with the heading text.
    if (!loose || number === (previous ?? 0) + 1) return { number, text: `${numbered[1] ?? ''}${numbered[4]}`.trim() };
  }
  const markdown = MD_HEADING_RE.exec(line);
  return markdown ? { number: null, text: markdown[1].trim() } : null;
}

function splitLine(line: string): { urls: string[]; text: string } {
  const urls = line.match(URL_RE) ?? [];
  return { urls, text: line.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim() };
}

/**
 * An outline has numbered (or #) headings that carry no link, and at least one
 * heading with a text note between it and its links. Flat lists, where every
 * line is its own product, keep the line-by-line reader.
 */
export function looksLikeOutline(text: string): boolean {
  const lines = plainListText(text).split('\n').map(line => line.trim()).filter(Boolean);
  let headings = 0;
  let notesWithLinks = 0;
  let inSection = false;
  let pendingNote = false;
  let previous: number | null = null;
  for (const line of lines) {
    const { urls, text: words } = splitLine(line);
    const found: { number: number | null; text: string } | null = !urls.length ? headingOf(line, previous) : null;
    if (found) { headings++; inSection = true; pendingNote = false; previous = found.number ?? previous; continue; }
    if (!inSection) continue;
    if (!urls.length) { pendingNote = true; continue; }
    if (pendingNote || words) notesWithLinks++;
    pendingNote = false;
  }
  return headings >= 2 && notesWithLinks >= 1;
}

const sentenceCase = (text: string) => {
  const lowered = text === text.toUpperCase() || text === text.toLowerCase() ? text.toLowerCase() : text;
  return lowered.replace(/\b[A-Z]{4,}\b/g, word => word.toLowerCase()).replace(/^./, first => first.toUpperCase());
};

const words = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);

/** "A variant in burgundy" -> "Burgundy"; "Another weird variant: Monogram Dunne: long story" -> "Monogram Dunne". */
export function variantLabel(note: string, heading: string, brand?: string | null): { label: string | null; remark: string | null } {
  const sentences = note.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept = sentences.filter(sentence => !UNSURE.test(sentence) && !COULD_NOT_FIND.test(sentence));
  const dropped = sentences.filter(sentence => !kept.includes(sentence));
  let text = kept.join(' ').trim();
  let remark = dropped.join(' ').trim() || null;
  const parts = text.split(/\s*:\s+|\s*:$/).map(part => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const meaningful = parts.findIndex(part => !GENERIC_LABEL.test(part));
    if (meaningful >= 0) {
      text = parts[meaningful];
      const rest = parts.slice(meaningful + 1).join(': ');
      if (rest) remark = [remark, rest].filter(Boolean).join(' ');
    }
  }
  // A long first clause is a description, not a label.
  if (text.length > 80) {
    const [first, ...others] = text.split(/[.;]\s+|\s+[-–—]\s+/);
    if (others.length) remark = [remark, others.join('. ')].filter(Boolean).join(' ');
    text = first.slice(0, 80);
  }
  const repeated = new Set([...words(heading), ...words(brand ?? ''), 'bag', 'bags']);
  let label = text
    .replace(/^\s*(?:should be|it'?s|its|this is|looks like)\s+/i, '')
    .replace(/\b(?:variants?|variations?|versions?)\b/gi, ' ')
    .replace(/[.!]+$/, '')
    .split(/\s+/).filter(word => !repeated.has(words(word).join('')) || !words(word).length).join(' ')
    .replace(/^\s*(?:(?:a|an|the|another|in|with|all|for)\s+)+/i, '')
    .replace(/\s+(?:in|with|for|and)\s*$/i, '')
    .replace(/\s+/g, ' ').trim();
  if (!/[A-Za-z0-9]/.test(label)) label = text.replace(/\s+/g, ' ').trim();
  return { label: label ? sentenceCase(label).slice(0, 80) : null, remark };
}

export function parseOutline(source: string, brand?: string | null): Outline {
  const lines = plainListText(source).split('\n');
  const warnings: string[] = [];
  const groups: OutlineGroup[] = [];
  const seenLinks = new Map<string, OutlineGroup>();
  let videoUrl: string | null = null;
  let heading: { number: number | null; text: string; line: number } | null = null;
  let current: OutlineGroup | null = null;
  let lastNumber: number | null = null;

  const open = (note: string | null, line: number): OutlineGroup => {
    const { label, remark } = note ? variantLabel(note, heading!.text, brand) : { label: null, remark: null };
    const group: OutlineGroup = {
      section: heading!.number, heading: heading!.text, note, variant: label, links: [], rejected: [], size: null, split_from: null, image_reference: null,
      search_pages: [], flags: note && UNSURE.test(note) ? ['partner_unsure'] : [], remarks: remark ? [remark] : [], source_line: line,
    };
    groups.push(group);
    return group;
  };

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const lineNumber = index + 1;
    if (!line || /^[-=_*~.\s]+$/.test(line)) return;
    const { urls, text } = splitLine(line);
    const found = !urls.length ? headingOf(line, heading?.number ?? lastNumber) : null;
    if (found) {
      lastNumber = found.number ?? lastNumber;
      heading = { ...found, line: lineNumber };
      current = open(null, lineNumber);
      return;
    }
    if (!heading) {
      // Preamble: the only thing worth keeping is which video this list is for.
      const video = urls.find(url => VIDEO_HOSTS.test(hostOf(url)));
      if (video && !videoUrl) videoUrl = video;
      else if (urls.length) warnings.push(`Line ${lineNumber}: link above the first numbered product was ignored`);
      return;
    }
    if (!urls.length) {
      if (COULD_NOT_FIND.test(text)) {
        // "Couldn't find it online" closes the note above it as a known gap.
        if (current && !current.links.length) { current.flags.push('partner_could_not_find'); current = null; }
        else if (current) current.remarks.push(text);
        return;
      }
      current = open(text, lineNumber);
      return;
    }
    // Text sharing a line with links labels those links, unless the line only
    // points at a search page or a social link: then it is just commentary.
    const listing = (url: string) => {
      const host = hostOf(url);
      return Boolean(host) && !VIDEO_HOSTS.test(host) && !SOCIAL_HOSTS.test(host) && !isSearchPageUrl(url);
    };
    if (text && !urls.some(listing)) (current ??= open(null, lineNumber)).remarks.push(text);
    else if (text && (!current || current.links.length || current.note === null)) current = open(text, lineNumber);
    else if (text && current) current.remarks.push(text);
    current ??= open(null, lineNumber);
    for (const rawUrl of urls) {
      const host = hostOf(rawUrl);
      if (!host) { warnings.push(`Line ${lineNumber}: unreadable link ignored`); continue; }
      if (VIDEO_HOSTS.test(host) || SOCIAL_HOSTS.test(host)) { warnings.push(`Line ${lineNumber}: ${host} link is not a seller listing; ignored`); continue; }
      let isImage = false;
      try { isImage = IMAGE_PATH.test(new URL(rawUrl).pathname); } catch { /* not an image */ }
      if (isImage) { current.image_reference ??= rawUrl.replace(/[.,;:!?]+$/, ''); continue; }
      if (isSearchPageUrl(rawUrl)) {
        current.search_pages.push(rawUrl);
        warnings.push(`Line ${lineNumber}: ${host} search-results page is not a product; kept for reference only`);
        continue;
      }
      const evidence = linkEvidence(rawUrl, `${brand ?? ''} ${heading.text}`);
      const earlier = seenLinks.get(evidence.url);
      if (earlier) {
        if (earlier !== current) warnings.push(`Line ${lineNumber}: ${host} listing already appears under "${earlier.heading}${earlier.variant ? ` / ${earlier.variant}` : ''}"; kept there only`);
        continue;
      }
      seenLinks.set(evidence.url, current);
      current.links.push(evidence);
    }
  });

  // A heading's empty default group only matters when the heading has nothing else.
  const filtered = groups.filter(group => group.note !== null || group.links.length || group.image_reference || group.flags.length
    || !groups.some(other => other !== group && other.section === group.section && other.heading === group.heading));
  // The brand has to be known before judging names: "Louis Vuitton" in every
  // listing title must not count as mentioning the family.
  const knownBrand = brand ?? brandFromHeadings(filtered.map(group => group.heading));
  const kept = filtered.flatMap(group => splitMixedGroup(rejectContradictoryLinks(group, knownBrand)));
  return { video_url: videoUrl, groups: kept, warnings };
}

/**
 * A listing whose own name does not mention the family, or states a colour the
 * variant note rules out, was filed under the wrong note. It is set aside with
 * the reason, never offered and never used as a reference photo.
 */
function rejectContradictoryLinks(group: OutlineGroup, brand?: string | null): OutlineGroup {
  const anchors = familyAnchors(group.heading, brand);
  const wanted = coloursIn(group.note ? variantLabel(group.note, group.heading, brand).label : '');
  const links: LinkEvidence[] = [];
  const rejected: RejectedLink[] = [...group.rejected];
  for (const link of group.links) {
    if (namesOtherProduct(link.name_words, anchors)) {
      rejected.push({ url: link.url, merchant: link.merchant, reason: 'other_product', detail: `listing name does not mention ${anchors.join(' / ')}` });
    } else if (coloursContradict(wanted, link.colors)) {
      rejected.push({ url: link.url, merchant: link.merchant, reason: 'colour_contradiction', detail: `note says ${wanted.join(' / ')}, listing says ${link.colors.join(' / ')}` });
    } else links.push(link);
  }
  return { ...group, links, rejected };
}

/**
 * One note whose links state different sizes (or, when the note names no
 * colour, different colours) is several variants. Each stated combination
 * becomes its own row. Links that do not say which one they are stay behind in
 * a row marked unstated, which is held for review rather than guessed into a size.
 */
function splitMixedGroup(group: OutlineGroup): OutlineGroup[] {
  const noteColours = coloursIn(group.variant ?? '');
  const sizeOf = (link: LinkEvidence) => link.sizes.length === 1 ? link.sizes[0] : '';
  const colourOf_ = (link: LinkEvidence) => [...link.colors].sort().join('/');
  const sizes = [...new Set(group.links.map(sizeOf).filter(Boolean))];
  const colourSets = [...new Map(group.links.filter(link => link.colors.length).map(link => [colourOf_(link), link.colors])).values()];
  const splitSize = sizes.length > 1;
  const splitColour = !noteColours.length && colourSets.length > 1
    && colourSets.every((a, i) => colourSets.every((b, j) => i === j || !a.some(colour => b.includes(colour))));
  if (!splitSize && !splitColour) return [group];
  const parts = new Map<string, { label: string; size: string | null; links: LinkEvidence[] }>();
  const unstated: LinkEvidence[] = [];
  for (const link of group.links) {
    const size = splitSize ? sizeOf(link) : '';
    const colour = splitColour ? colourOf_(link) : '';
    if ((splitSize && !size) || (splitColour && !colour)) { unstated.push(link); continue; }
    const label = [colour, size].filter(Boolean).join(' ');
    const part = parts.get(label) ?? { label, size: size || null, links: [] };
    part.links.push(link);
    parts.set(label, part);
  }
  const base = group.variant;
  const out: OutlineGroup[] = [...parts.values()].map(part => ({
    ...group, links: part.links, rejected: [], search_pages: [], remarks: [], size: part.size,
    variant: [base, part.label].filter(Boolean).join(' '), split_from: base ?? group.heading,
  }));
  if (unstated.length) {
    const what = [splitSize ? 'size' : '', splitColour ? 'colour' : ''].filter(Boolean).join(' and ');
    out.push({
      ...group, links: unstated, size: null, split_from: base ?? group.heading,
      variant: [base, `(${what} unstated)`].filter(Boolean).join(' '), flags: [...group.flags, 'variant_unstated'],
    });
  } else if (out.length) {
    // Nothing left behind: the note's remarks and set-aside links travel with the first row.
    out[0] = { ...out[0], rejected: group.rejected, search_pages: group.search_pages, remarks: group.remarks };
  }
  return out;
}

/** When most headings open with the same two words, that is the brand ("Louis Vuitton ..."). */
export function brandFromHeadings(headings: string[]): string | null {
  const counts = new Map<string, { text: string; count: number }>();
  for (const heading of new Set(headings)) {
    const [first, second] = heading.split(/\s+/);
    if (!first || !second || !/^[A-Za-z][A-Za-z'&.-]+$/.test(first) || !/^[A-Za-z][A-Za-z'&.-]+$/.test(second)) continue;
    const key = `${first} ${second}`.toLowerCase();
    const entry = counts.get(key) ?? { text: `${first} ${second}`, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  const total = new Set(headings).size;
  const best = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  return best && total >= 3 && best.count >= Math.ceil(total / 2) ? best.text : null;
}

/** "Louis Vuitton Neverfull Tote" / "vuitton side trunk" -> "Neverfull Tote" / "Side Trunk". */
export function familyName(heading: string, brand?: string | null): string {
  const brandWords = words(brand ?? '');
  const parts = heading.split(/\s+/);
  while (parts.length > 1 && brandWords.includes(words(parts[0]).join(''))) parts.shift();
  const text = parts.join(' ').trim();
  return text === text.toLowerCase() ? text.replace(/\b[a-z]/g, letter => letter.toUpperCase()) : text;
}

/** Small stable hash for video-local ids. Not security relevant. */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export const GROUP_ID_PREFIX = 'VR-';

/**
 * Video-local variant id for a group the partner named but gave no code for.
 * It says "the thing this partner calls X in this video" and nothing more, so
 * it can never join a product in another video or another seller's catalog.
 */
export function groupVariantId(scope: string, section: number | null, family: string, variant: string | null): string {
  const slug = (text: string) => words(text).join('-').slice(0, 40).replace(/-+$/, '');
  return `${GROUP_ID_PREFIX}${videoLocalScope(scope)}-${section ?? slug(family)}-${variant ? slug(variant) : 'main'}`.slice(0, 120);
}

export const isGroupVariantId = (code: string | null | undefined) => Boolean(code && code.toUpperCase().startsWith(GROUP_ID_PREFIX));

/** The scope segment a video-local id must carry for this content. */
export function videoLocalScope(contentRef: string): string {
  let ref = contentRef.trim().replace(/^youtube:/i, '');
  try { const id = new URL(ref).searchParams.get('v'); if (id) ref = id; } catch { /* not a URL */ }
  return /^[A-Za-z0-9_-]{4,20}$/.test(ref) ? ref : shortHash(ref);
}

/** A video-local id is only valid on the content it was minted for. */
export function videoLocalIdBelongsTo(id: string | null | undefined, contentRef: string | null | undefined): boolean {
  if (!id || !contentRef || !isGroupVariantId(id)) return false;
  return id.toLowerCase().startsWith(`${GROUP_ID_PREFIX}${videoLocalScope(contentRef)}-`.toLowerCase());
}
