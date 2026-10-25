import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRosterText, canonicalizeOfferUrl, applyWindows, offersToCsv, isSearchPage, toPartnerImport } from '../../tools/roster-text-import.mjs';
import { adaptVideoResearch } from '../../tools/video-sku-review-adapter.mjs';

const SAMPLE = [
  'SKU LIST FOR [https\\://www\\.youtube\\.com/watch?v=abc123XYZ](https://www.youtube.com/watch?v=abc123XYZ)',
  '',
  '1\\. sneaker',
  'This link is a search from the shopping platform. [https\\://shop.example/search?q=sneaker](https://shop.example/search?q=sneaker)',
  '[https\\://shop.example/products/sneaker-red-1](https://shop.example/products/sneaker-red-1?utm_source=x&variant=7)',
  'Blue variant',
  'https\\://shop.example/products/sneaker-blue-2',
  '[https\\://www\\.ebay.com/itm/123456789012?\\_skw=a\\&hash=b](https://www.ebay.com/itm/123456789012?_skw=a&hash=b)',
  '2 Hat',
  'Not sure about this one, it did not open',
  '[https\\://shop.example/products/hat-1](https://shop.example/products/hat-1)',
  'hat shearling',
  'Couldn’t find it online',
  '​[https\\://shop.example/products/hat-1](https://shop.example/products/hat-1)',
  '[https\\://shop.example/products/sneaker-red-1](https://shop.example/products/sneaker-red-1)'
].join('\n');

test('parses video id, sections, variant notes and keeps variant query params', () => {
  const out = parseRosterText(SAMPLE);
  assert.equal(out.video_id, 'abc123XYZ');
  assert.deepEqual(out.sections.map(s => [s.section, s.family]), [[1, 'sneaker'], [2, 'Hat']]);
  const offers = out.offers.filter(o => o.link_type === 'offer');
  assert.equal(offers[0].url, 'https://shop.example/products/sneaker-red-1?variant=7');
  assert.equal(offers[1].variant_note, 'Blue variant');
  assert.equal(offers[2].url, 'https://www.ebay.com/itm/123456789012');
});

test('search pages are kept out of offers; unresolved items stay explicit gaps', () => {
  const out = parseRosterText(SAMPLE);
  assert.equal(out.audit.search_pages.length, 1);
  assert.equal(out.offers.filter(o => o.link_type === 'search_page').length, 1);
  assert.deepEqual(out.unresolved.map(u => [u.section, u.variant, u.reason]), [[2, 'hat shearling', 'USER_COULD_NOT_FIND']]);
  const unsure = out.offers.find(o => o.url.endsWith('/hat-1'));
  assert.deepEqual(unsure.flags, ['USER_UNSURE']);
});

test('duplicate links are reported, not silently repeated; variant selectors keep URLs distinct', () => {
  const out = parseRosterText(SAMPLE);
  assert.equal(out.offers.filter(o => o.url.includes('hat-1')).length, 1);
  assert.equal(out.audit.duplicate_urls.length, 1);
  // sneaker-red-1 with ?variant=7 and without it are different merchant variants.
  assert.equal(out.offers.filter(o => o.url.includes('sneaker-red-1')).length, 2);
  const cross = parseRosterText('1 A\nhttps://s.example/p/a-1\n2 B\nhttps://s.example/p/a-1\n');
  assert.deepEqual(cross.audit.duplicate_urls.map(d => [d.first_section, d.repeat_section]), [[1, 2]]);
  assert.equal(cross.offers.length, 1);
});

test('canonicalization drops tracking but not variant selectors; rejects non-https', () => {
  assert.equal(canonicalizeOfferUrl('https://x.example/p?variant=1&utm_medium=a&srsltid=z'), 'https://x.example/p?variant=1');
  assert.throws(() => canonicalizeOfferUrl('http://x.example/p'), /https/);
  assert.equal(isSearchPage('https://x.example/products/a-b-1'), false);
  assert.equal(isSearchPage('https://x.example/search?q=a'), true);
});

test('windows run to the next section and never claim appearance intervals', () => {
  const out = parseRosterText(SAMPLE);
  const windows = applyWindows(out.sections, [{ section: 1, start_ms: 1000 }, { section: 2, start_ms: 5000 }], 9000);
  assert.deepEqual(windows.map(w => [w.window_start_ms, w.window_end_ms]), [[1000, 4999], [5000, 9000]]);
  assert.ok(windows.every(w => w.window_basis === 'DISCUSSION_WINDOW_NOT_APPEARANCE_INTERVAL'));
  assert.throws(() => applyWindows(out.sections, [{ section: 1, start_ms: 5000 }, { section: 2, start_ms: 1000 }], 9000), /increase/);
});

test('output feeds the existing review adapter without losing the search-page exclusion', () => {
  const out = parseRosterText(SAMPLE);
  const sections = applyWindows(out.sections, [{ section: 1, start_ms: 1000 }, { section: 2, start_ms: 5000 }], 9000);
  const adapted = adaptVideoResearch({
    sectionsFile: { video_id: out.video_id, sections },
    reviewFile: { video_id: out.video_id, clicks: [{ id: 'c1', video_timestamp_ms: 2000, point: { x: .5, y: .5 } }] },
    offerCsv: offersToCsv(out.offers)
  });
  assert.equal(adapted.audit.excluded_offers[0].reason, 'SEARCH_PAGE');
  assert.equal(adapted.counts.offers, out.offers.filter(o => o.link_type === 'offer').length);
  assert.equal(adapted.cases[0].decision, 'ABSTAIN_UNVERIFIED');
  assert.deepEqual(adapted.cases[0].candidate_sections, ['1']);
});

test('partner import manifest carries offers only: no search pages, no windows, no invented SKUs', () => {
  const out = parseRosterText(SAMPLE.replace('1\\. sneaker', '1\\. Louis Vuitton sneaker'));
  const manifest = toPartnerImport(out);
  assert.equal(manifest.platform, 'youtube');
  assert.equal(manifest.content_ref, 'abc123XYZ');
  assert.equal(manifest.offers.length, out.offers.filter(o => o.link_type === 'offer').length);
  assert.ok(manifest.offers.every(o => Object.keys(o).sort().join() === 'destination,family'));
  assert.ok(manifest.offers.every(o => !o.destination.includes('/search')));
  assert.equal(manifest.offers[0].family, 'sneaker');
  assert.throws(() => toPartnerImport({ video_id: null, sections: [], offers: [] }), /video id/);
});

test('inline notes and singular cautions scope to the right links', () => {
  const md = [
    'V https://youtu.be/abcdefghijk', '',
    '1. bag', 'This link is a search. https://shop.example/search?q=bag',
    'https://shop.example/item/1', 'A variant in red https://shop.example/item/2', '',
    '2. other', 'Not sure about this link below it did not open', 'https://shop.example/item/3', 'https://shop.example/item/4'
  ].join('\n');
  const { offers } = parseRosterText(md);
  const by = n => offers.find(o => o.url.endsWith(n));
  assert.equal(by('/item/1').variant_note, '');
  assert.equal(by('/item/2').variant_note, 'A variant in red');
  assert.deepEqual(by('/item/3').flags, ['USER_UNSURE']);
  assert.deepEqual(by('/item/4').flags, []);
  assert.equal(by('/item/4').variant_note, '');
});
