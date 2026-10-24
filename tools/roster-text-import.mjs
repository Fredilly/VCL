#!/usr/bin/env node
// Turns a creator/operator's plain-text product list (numbered headings, pasted links,
// plain-text variant notes) into the section + seller-offer inputs used by
// tools/video-sku-review-adapter.mjs.
//
// This is an input normalizer, not identity verification. Every link stays an
// UNVERIFIED seller offer; notes such as "couldn't find it online" are preserved as
// explicit gaps instead of being dropped. No network access.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRACKING = /^(utm_|mk(evt|cid|rid)$|campid$|customid$|toolid$|srsltid$|gclid$|fbclid$|ultra_crid$|scid$|itm(meta|prp)$|_skw$|hash$)/i;
const UNRESOLVED = /couldn.?t find|could not find|not found|can.?t find|unavailable/i;
const UNSURE = /not sure|unsure|didn.?t open|maybe|\?\s*$/i;

// Markdown exports escape punctuation (https\://, \_, \&). Only unescape non-alphanumerics.
const unescapeMd = text => text.replace(/[​‌‍﻿]/g, '').replace(/\\([^A-Za-z0-9\s])/g, '$1');

export function canonicalizeOfferUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Only https URLs are accepted');
  url.hash = '';
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host.endsWith('ebay.com')) {
    const item = /\/itm\/(?:[^/]+\/)?(\d{9,})/.exec(url.pathname);
    // The item id fully identifies the listing; everything else is search/tracking state.
    if (item) return `https://www.ebay.com/itm/${item[1]}`;
  }
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  return url.toString();
}

export function isSearchPage(raw) {
  try {
    const url = new URL(raw);
    return /\/(search|s|sch)(\/|$)/i.test(url.pathname) || ['q', 'query', '_nkw', 'keyword'].some(k => url.searchParams.has(k));
  } catch { return false; }
}

const sellerKind = host => /(^|\.)louisvuitton\.com$|(^|\.)hermes\.com$|(^|\.)nike\.com$/.test(host) ? 'brand_official' : 'reseller_or_marketplace';

export function parseRosterText(source) {
  const lines = unescapeMd(source).split(/\r?\n/);
  const videoMatch = /(?:youtube\.com\/watch\?[^\s)]*v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(unescapeMd(source));
  const sections = [];
  const offers = [];
  const unresolved = [];
  const audit = { duplicate_urls: [], search_pages: [], malformed: [], orphan_links: [] };
  let section = null;
  let note = '';
  let noteFlags = [];

  const urlsIn = line => {
    const found = [];
    const withoutMd = line.replace(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g, (_, u) => { found.push(u); return ' '; });
    for (const m of withoutMd.matchAll(/https?:\/\/[^\s)\]]+/g)) found.push(m[0]);
    return { urls: found, text: withoutMd.replace(/https?:\/\/[^\s)\]]+/g, ' ').trim() };
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const { urls, text } = urlsIn(line);
    const heading = !urls.length && /^(\d{1,3})\s*(?:[.)]\s*|\s+)(\S.*)$/.exec(line);
    // First line carries the video link; it is not a product link.
    if (urls.length && /youtu(?:\.be|be\.com)/.test(urls[0]) && !section) return;
    if (heading) {
      section = { section: Number(heading[1]), family: heading[2].trim(), source_line: index + 1 };
      sections.push(section);
      note = ''; noteFlags = [];
      return;
    }
    if (!urls.length) {
      if (!section) return;
      if (UNRESOLVED.test(text)) {
        unresolved.push({ section: section.section, variant: note, reason: 'USER_COULD_NOT_FIND', source_line: index + 1 });
        note = ''; noteFlags = [];
      } else {
        note = text;
        noteFlags = UNSURE.test(text) ? ['USER_UNSURE'] : [];
      }
      return;
    }
    for (const rawUrl of urls) {
      if (!section) { audit.orphan_links.push({ source_line: index + 1 }); continue; }
      let canonical;
      try { canonical = canonicalizeOfferUrl(rawUrl); } catch { audit.malformed.push({ section: section.section, source_line: index + 1 }); continue; }
      const host = new URL(canonical).hostname.replace(/^www\./, '');
      if (isSearchPage(canonical)) {
        audit.search_pages.push({ section: section.section, source_line: index + 1, merchant: host });
        offers.push({ source_line: index + 1, section: section.section, url: canonical, link_type: 'search_page', variant_note: '', merchant: host, seller_kind: sellerKind(host), flags: [] });
        continue;
      }
      offers.push({
        source_line: index + 1, section: section.section, url: canonical, link_type: 'offer',
        variant_note: note, merchant: host, seller_kind: sellerKind(host), flags: [...noteFlags]
      });
    }
    // A note applies to the links that follow it until the next note.
    if (text && !UNRESOLVED.test(text)) { note = text; noteFlags = UNSURE.test(text) ? ['USER_UNSURE'] : []; }
  });

  const seen = new Map();
  const unique = [];
  for (const offer of offers) {
    if (offer.link_type === 'offer') {
      const prior = seen.get(offer.url);
      if (prior) { audit.duplicate_urls.push({ url_host: offer.merchant, first_section: prior.section, repeat_section: offer.section, source_line: offer.source_line }); continue; }
      seen.set(offer.url, offer);
    }
    unique.push(offer);
  }
  return { video_id: videoMatch?.[1] ?? null, sections, offers: unique, unresolved, audit };
}

/** windows: [{section, start_ms}] in list order. Each window runs to the next start; the last to endMs. */
export function applyWindows(sections, starts, endMs) {
  const byId = new Map(starts.map(s => [Number(s.section), s.start_ms]));
  const ordered = sections.map(s => ({ ...s, start: byId.get(s.section) }));
  if (ordered.some(s => !Number.isSafeInteger(s.start) || s.start < 0)) throw new Error('Every section needs a start_ms');
  for (let i = 1; i < ordered.length; i++) if (ordered[i].start <= ordered[i - 1].start) throw new Error('Section starts must increase');
  return ordered.map((s, i) => {
    const end = i + 1 < ordered.length ? ordered[i + 1].start - 1 : endMs;
    if (!(end > s.start)) throw new Error('Invalid window for section ' + s.section);
    return { section: s.section, family: s.family, window_start_ms: s.start, window_end_ms: end,
      existing_seed_identifier: null, window_basis: 'DISCUSSION_WINDOW_NOT_APPEARANCE_INTERVAL' };
  });
}

/** Manifest for `tools/partner-learning.mjs import`. Only documented row fields are emitted:
 * the destination URL (the importer reads that variant's own product data and image) and the
 * section heading as a family hint. Windows are deliberately not sent: the production roster
 * needs no timestamps, and a wrong hard window would exclude the true product. */
export function toPartnerImport(parsed, { platform = 'youtube' } = {}) {
  if (!parsed.video_id) throw new Error('No video id found in the roster header');
  const family = new Map(parsed.sections.map(s => [s.section, s.family.replace(/^(louis vuitton|lv)\s+/i, '').trim()]));
  return {
    platform, content_ref: parsed.video_id,
    offers: parsed.offers.filter(o => o.link_type === 'offer').map(o => ({ destination: o.url, family: family.get(o.section) }))
  };
}

const csvCell = value => /[",\n]/.test(String(value)) ? '"' + String(value).replace(/"/g, '""') + '"' : String(value);
export function offersToCsv(offers) {
  const header = ['source_line', 'section', 'url', 'link_type', 'variant_note', 'merchant', 'seller_kind', 'flags'];
  return [header.join(','), ...offers.map(o => header.map(h => csvCell(h === 'flags' ? o.flags.join('|') : o[h])).join(','))].join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const input = args.find(a => !a.startsWith('--') && a !== flag('--windows') && a !== flag('--out-dir') && a !== flag('--end-ms'));
  const outDir = flag('--out-dir');
  if (!input || !outDir) {
    console.error('Usage: node tools/roster-text-import.mjs roster.md --out-dir DIR [--windows starts.json --end-ms N]');
    process.exit(2);
  }
  const parsed = parseRosterText(readFileSync(input, 'utf8'));
  mkdirSync(outDir, { recursive: true });
  const windows = flag('--windows');
  const sections = windows ? applyWindows(parsed.sections, JSON.parse(readFileSync(windows, 'utf8')), Number(flag('--end-ms'))) : parsed.sections;
  writeFileSync(join(outDir, 'seller_references.csv'), offersToCsv(parsed.offers));
  writeFileSync(join(outDir, 'video_sections.json'), JSON.stringify({ video_id: parsed.video_id, sections }, null, 2) + '\n');
  writeFileSync(join(outDir, 'partner_import.json'), JSON.stringify(toPartnerImport(parsed), null, 2) + '\n');
  writeFileSync(join(outDir, 'roster_audit.json'), JSON.stringify({
    video_id: parsed.video_id,
    counts: { sections: parsed.sections.length, offers: parsed.offers.filter(o => o.link_type === 'offer').length,
      search_pages: parsed.audit.search_pages.length, unresolved: parsed.unresolved.length, duplicates: parsed.audit.duplicate_urls.length },
    unresolved: parsed.unresolved, audit: parsed.audit,
    note: 'Offers are UNVERIFIED seller listings. Search pages and unresolved variants are never imported as products.'
  }, null, 2) + '\n');
  console.log(JSON.stringify({ video_id: parsed.video_id, sections: parsed.sections.length,
    offers: parsed.offers.filter(o => o.link_type === 'offer').length, search_pages: parsed.audit.search_pages.length,
    unresolved: parsed.unresolved.length, duplicates: parsed.audit.duplicate_urls.length }, null, 2));
}
