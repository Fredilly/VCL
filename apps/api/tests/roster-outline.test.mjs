import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { loadModule } from './helpers/load-ts.mjs';
import { chunkByLinks, localPoster, runRosterIntake } from '../../../tools/roster-intake.mjs';
import { docxToText } from '../../../tools/roster-list-file.mjs';

const intake = loadModule(new URL('../src/roster-intake.ts', import.meta.url).pathname);
const outline = loadModule(new URL('../src/roster-outline.ts', import.meta.url).pathname);
const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));

// The shape a person actually produces when they sit down with a video and a
// browser: a numbered product, variant notes, a pile of links under each note,
// side comments, a search page pasted by mistake, things they could not find.
// Listing ids are invented; the URL shapes are the real ones.
const OUTLINE = `LV SKU FOR https://www.youtube.com/watch?v=n9u8ynhBdSo

1. vuitton side trunk
This link is a search from the shopping platform. https://www.fashionphile.com/search?sortBy=x&q=vuitton%20side%20trunk
https://www.fashionphile.com/products/louis-vuitton-monogram-side-trunk-pm-1000001
https://www.ebay.com/itm/900000000001?_skw=louis+vuitton+side+trunk&itmmeta=AAA&hash=item1:g:x&itmprp=enc%3AAQ
https://poshmark.com/listing/Louis-Vuitton-Monogram-MM-SoftSide-Trunk-6ac9b3b1ebb1a50f2b94b217
A variant in burgundy https://item.rakuten.co.jp/selecthouse/lv-m25669/?ultra_crid=lv-m25669&scid=s_kwa
A variant in black with gold buckles
https://www.fashionphile.com/products/louis-vuitton-grained-calfskin-side-trunk-pm-black-1000002
Another weird variant: Monogram Dunne: Colorful motifs on canvas. The chic design features metallic corner hardware and S-lock style fasteners, symbolizing the house.
https://jp.mercari.com/item/m80000000001

2. Louis Vuitton Vagabond Hobo Bag
Not sure about this link below it didn’t open cos of my vpn. Should be all brown variation
https://eu.louisvuitton.com/eng-e1/products/vagabond-hobo-h39-nvprod7260131v/M28392
https://poshmark.com/listing/Louis-Vuitton-Vagabond-Hobo-Shoulder-Bag-Leather-Black-6acbea537f7b470df988f763
3. Louis Vuitton Neverfull Tote
Variant with black badge
https://jp.louisvuitton.com/jpn-jp/products/neverfull-bandouliere-inside-out-bb-nvprod5770174v/M28347
louis vuitton neverfull tote bag shearling
Couldn’t find it online
4. Louis Vuitton Carryall bag
https://www.fashionphile.com/products/louis-vuitton-monogram-carryall-mm-1000003
https://poshmark.com/listing/Louis-Vuitton-CarryAll-MMM46197-6ad88543221dcbe945d4af17
Black variant
https://www.fashionphile.com/products/louis-vuitton-lambskin-carryall-vibe-mm-black-1000004?variant=58270709055791&utm_source=google
5 Speedy Bag Bandouliere
Red Variant
https://www.fashionphile.com/products/louis-vuitton-calfskin-monogram-speedy-p9-bandouliere-20-red-1000005
https://www.fashionphile.com/products/louis-vuitton-calfskin-monogram-speedy-p9-bandouliere-40-red-1000006
https://www.ebay.com/itm/900000000009
​​[https://poshmark.com/listing/East-West-Pochette-Metis-Monogram-Canvas-6a74a5771fa204c08712c202](https://poshmark.com/listing/East-West-Pochette-Metis-Monogram-Canvas-6a74a5771fa204c08712c202)
Black multicolor variant
https://poshmark.com/listing/LOUIS-VUITTON-Speedy-Handbag-Multicolor-White-6ab339e0345e38b3eeb9d9cf
`;

const parsed = () => intake.parseRosterIntake(OUTLINE);
const byTitle = () => Object.fromEntries(parsed().items.map(item => [item.title, item]));

test('an outline becomes one roster row per variant the partner named, not one per line', () => {
  const result = parsed();
  assert.equal(result.layout, 'outline');
  assert.equal(result.video_url, 'https://www.youtube.com/watch?v=n9u8ynhBdSo');
  same(result.items.map(item => item.title), [
    'Side Trunk - PM', 'Side Trunk - MM', 'Side Trunk - (size unstated)', 'Side Trunk - Burgundy', 'Side Trunk - Black with gold buckles', 'Side Trunk - Monogram Dunne',
    'Vagabond Hobo Bag - Brown', 'Neverfull Tote - Black badge', 'Neverfull Tote - Shearling',
    'Carryall bag', 'Carryall bag - Black',
    'Speedy Bag Bandouliere - Red 20', 'Speedy Bag Bandouliere - Red 40', 'Speedy Bag Bandouliere - Red (size unstated)', 'Speedy Bag Bandouliere - Black multicolor',
  ]);
  // Brand comes from the headings; the header line and side comments are not products.
  assert.ok(result.items.every(item => item.brand === 'Louis Vuitton' && item.object_type === 'bag'));
  assert.ok(result.warnings.some(warning => /Brand read from the headings/.test(warning)));
  assert.ok(!result.items.some(item => /search from the shopping|not sure|couldn|SKU FOR/i.test(item.title)));
  same(result.items.map(item => item.section), [1, 1, 1, 1, 1, 1, 2, 3, 3, 4, 4, 5, 5, 5, 5]);
});

test('every link under a note is an offer of that variant; search pages and tracking never are', () => {
  const rows = byTitle();
  // The heading's own links mix PM and MM, so they are separate variants; the
  // eBay link does not say which, so it waits in an unstated row.
  same(rows['Side Trunk - PM'].urls, ['https://www.fashionphile.com/products/louis-vuitton-monogram-side-trunk-pm-1000001']);
  same(rows['Side Trunk - MM'].urls, ['https://poshmark.com/listing/Louis-Vuitton-Monogram-MM-SoftSide-Trunk-6ac9b3b1ebb1a50f2b94b217']);
  same(rows['Side Trunk - (size unstated)'].urls, ['https://www.ebay.com/itm/900000000001']);
  assert.ok(rows['Side Trunk - (size unstated)'].hints.includes('search_page_ignored:1'));
  same(rows['Side Trunk - (size unstated)'].remarks, ['This link is a search from the shopping platform.']);
  // A variant selector survives; tracking does not.
  same(rows['Carryall bag - Black'].urls, ['https://www.fashionphile.com/products/louis-vuitton-lambskin-carryall-vibe-mm-black-1000004?variant=58270709055791']);
  same(rows['Side Trunk - Burgundy'].urls, ['https://item.rakuten.co.jp/selecthouse/lv-m25669/']);
  // Merchant listing ids are read for each link.
  assert.equal(rows['Side Trunk - (size unstated)'].listing_ids['https://www.ebay.com/itm/900000000001'], 'EBAY-900000000001');
  assert.equal(rows['Side Trunk - PM'].listing_ids[rows['Side Trunk - PM'].urls[0]], 'FP-1000001');
  assert.equal(rows['Side Trunk - MM'].listing_ids[rows['Side Trunk - MM'].urls[0]], 'POSH-6ac9b3b1ebb1a50f2b94b217');
});

test('one note whose links mix sizes becomes one variant per size; unstated listings are held, not guessed', () => {
  const rows = byTitle();
  same(rows['Speedy Bag Bandouliere - Red 20'].urls, ['https://www.fashionphile.com/products/louis-vuitton-calfskin-monogram-speedy-p9-bandouliere-20-red-1000005']);
  same(rows['Speedy Bag Bandouliere - Red 40'].urls, ['https://www.fashionphile.com/products/louis-vuitton-calfskin-monogram-speedy-p9-bandouliere-40-red-1000006']);
  same([rows['Speedy Bag Bandouliere - Red 20'].match.size, rows['Speedy Bag Bandouliere - Red 40'].match.size], ['20', '40']);
  assert.notEqual(rows['Speedy Bag Bandouliere - Red 20'].sku, rows['Speedy Bag Bandouliere - Red 40'].sku);
  const unstated = rows['Speedy Bag Bandouliere - Red (size unstated)'];
  same(unstated.urls, ['https://www.ebay.com/itm/900000000009']);
  same(unstated.flags, ['variant_unstated']);
  // A note with a single stated size is left alone.
  assert.ok(!Object.keys(rows).some(title => /^Carryall bag - Black /.test(title)));
});

test('links that contradict the family or the variant are set aside with the reason, never offered', () => {
  const rows = byTitle();
  // A Pochette Metis filed under Speedy: its own name never mentions the product.
  const held = parsed().items.filter(item => item.section === 5).flatMap(item => item.rejected_links ?? []);
  same(held.map(link => [link.reason, link.merchant]), [['other_product', 'poshmark.com'], ['colour_contradiction', 'poshmark.com']]);
  assert.ok(!parsed().items.some(item => item.urls.some(url => /Pochette-Metis/.test(url))));
  // The note says black, the listing says white.
  const black = rows['Speedy Bag Bandouliere - Black multicolor'];
  same(black.urls, []);
  same(black.rejected_links.map(link => link.reason), ['colour_contradiction']);
  // A second colour in the note (hardware) is not a contradiction.
  assert.equal(rows['Side Trunk - Black with gold buckles'].urls.length, 1);
  assert.equal(outline.colourOf('bluish'), 'blue');
  assert.equal(outline.colourOf('gray'), 'grey');
  same(outline.familyAnchors('Louis Vuitton Vagabond Hobo Bag leather version for men', 'Louis Vuitton'), ['vagabond']);
});

test('identity: a code is adopted only when every link of the variant states it; otherwise the id is video-local', () => {
  const rows = byTitle();
  // Single link, and it states a manufacturer code.
  same([rows['Side Trunk - Burgundy'].sku, rows['Side Trunk - Burgundy'].sku_basis], ['M25669', 'link']);
  same([rows['Neverfull Tote - Black badge'].sku, rows['Neverfull Tote - Black badge'].sku_basis], ['M28347', 'link']);
  // One of two links states a code: a suggestion, not the row's identity.
  assert.equal(rows['Carryall bag'].sku_basis, 'partner_group');
  assert.equal(rows['Carryall bag'].sku, 'VR-n9u8ynhBdSo-4-main');
  same(rows['Carryall bag'].link_codes.map(entry => entry.code), ['M46197']);
  // Once the contradicting listing is set aside, the brand's own link is the only one left and states the code.
  same([rows['Vagabond Hobo Bag - Brown'].sku, rows['Vagabond Hobo Bag - Brown'].sku_basis], ['M28392', 'link']);
  // No codes anywhere: stable, readable, scoped to this video.
  assert.equal(rows['Side Trunk - Black with gold buckles'].sku, 'VR-n9u8ynhBdSo-1-black-with-gold-buckles');
  assert.ok(outline.isGroupVariantId(rows['Speedy Bag Bandouliere - Red 20'].sku));
  // The same list for another video can never produce the same id.
  const other = intake.parseRosterIntake(OUTLINE, {}, { platform: 'youtube', content_ref: 'AAAAAAAAAAA' });
  assert.equal(other.items[4].sku, 'VR-AAAAAAAAAAA-1-black-with-gold-buckles');
  assert.equal(outline.videoLocalIdBelongsTo(other.items[4].sku, 'AAAAAAAAAAA'), true);
  assert.equal(outline.videoLocalIdBelongsTo(other.items[4].sku, 'n9u8ynhBdSo'), false);
  assert.equal(outline.videoLocalIdBelongsTo('M46197', 'n9u8ynhBdSo'), false);
  // Prose is never a SKU ("S-lock style fasteners", "SKU FOR <video>").
  assert.ok(!parsed().items.some(item => /^(fasteners|for)$/i.test(item.sku ?? '')));
});

test('partner remarks are kept as review flags instead of becoming products', () => {
  const rows = byTitle();
  same(rows['Vagabond Hobo Bag - Brown'].flags, ['partner_unsure']);
  same(rows['Neverfull Tote - Shearling'].flags, ['partner_could_not_find']);
  assert.equal(rows['Neverfull Tote - Shearling'].urls.length, 0);
  assert.match(rows['Side Trunk - Monogram Dunne'].remarks[0], /Colorful motifs/);
});

test('flat lists keep the line-by-line reader', () => {
  for (const flat of [
    '1. Side Trunk PM M2A578 https://shop.co/a\n2. CarryAll MM M46197 https://shop.co/b\n3. Multipass M2A078',
    '0:24 Side Trunk PM - style M2A578\n2:43 Vagabond Hobo M28392\n   https://reseller.shop/x',
    'https://shop.co/a\nhttps://shop.co/b',
  ]) assert.equal(intake.parseRosterIntake(flat, { brand: 'LV' }).layout, 'flat');
  assert.equal(outline.looksLikeOutline(OUTLINE), true);
});

test('variant labels and link evidence', () => {
  const label = (note, heading = 'Louis Vuitton Speedy Bag Bandouliere') => outline.variantLabel(note, heading, 'Louis Vuitton').label;
  assert.equal(label('A variant in burgundy'), 'Burgundy');
  assert.equal(label('WHITISH cream  variant'), 'Whitish cream');
  assert.equal(label('vuitton speedy p9 bandouliere bluish silver variant'), 'P9 bluish silver');
  assert.equal(label('Soft speedy boho'), 'Soft boho');
  assert.equal(label('Another weird variant: Monogram Dunne: long description here.'), 'Monogram Dunne');
  const evidence = url => outline.linkEvidence(url, 'Louis Vuitton');
  same(evidence('https://poshmark.com/listing/Louis-Vuitton-CarryAll-MMM46197-6ad88543221dcbe945d4af17').codes, ['M46197']);
  same(evidence('https://eu.louisvuitton.com/eng-e1/products/vagabond-hobo-h39-nvprod7260131v/M28392').codes, ['M28392']);
  // Listing numbers, product ids and hex ids are not manufacturer codes.
  same(evidence('https://www.fashionphile.com/products/louis-vuitton-monogram-side-trunk-pm-1991017').codes, []);
  same(evidence('https://jp.mercari.com/item/m87766194435').codes, []);
  same(evidence('https://www.nike.com/t/jordan-mens-polo-mbLOwHgG/II5381-417').codes, ['II5381-417']);
  assert.equal(outline.isSearchPageUrl('https://www.ebay.com/sch/i.html?_nkw=speedy'), true);
  assert.equal(outline.isSearchPageUrl('https://www.ebay.com/itm/123456789012'), false);
});

const page = overrides => ({ sku: null, variant_id: null, title: null, brand: null, object_type: null, canonical_url: null, image_reference: null, price: null, currency: null, resolution: 'resolved', http_status: 200, ...overrides });
function deps({ pages = {}, hits = [], loads = () => true } = {}) {
  const calls = { search: 0 };
  return { calls, metadata: async url => pages[url] ?? page({ resolution: 'unavailable' }), imageLoads: async url => loads(url), search: async () => { calls.search++; return hits; } };
}

const video = { platform: 'youtube', content_ref: 'n9u8ynhBdSo' };
const carry = () => byTitle()['Carryall bag'];
const inStock = extra => page({ availability: 'InStock', ...extra });

test('a variant is READY only from listings whose seller says they can be bought now', async () => {
  const row = carry();
  const [a, b] = row.urls;
  const out = await intake.resolveIntakeItem(row, deps({ pages: {
    [a]: inStock({ sku: '1000003', title: 'Louis Vuitton Monogram CarryAll MM', image_reference: 'https://cdn.shop/a.jpg', price: '2500', currency: 'USD' }),
    [b]: page({ resolution: 'unavailable', http_status: 403 }),
  } }));
  assert.equal(out.status, 'READY', JSON.stringify(out.reasons));
  assert.equal(out.sku_source, 'partner_group');
  same(out.offers.map(offer => [offer.provider, offer.page, offer.availability]), [['fashionphile.com', 'resolved', 'in_stock'], ['poshmark.com', 'blocked', 'unconfirmed']]);
  // Only the confirmed listing is importable; the blocked one is not an offer.
  const manifest = intake.buildRosterManifest(video, [out]);
  same(manifest.offers.map(offer => offer.destination), [a]);
  assert.equal(intake.summarizeIntake([out]).offers, 1);

  // A page that resolves but states no availability confirms nothing.
  const silent = await intake.resolveIntakeItem(row, deps({ pages: { [a]: page({ image_reference: 'https://cdn.shop/a.jpg' }), [b]: page({ image_reference: 'https://cdn.shop/b.jpg' }) } }));
  assert.equal(silent.status, 'NEEDS_REVIEW');
  same(silent.reasons, ['no_confirmed_offer']);
  assert.equal(intake.buildRosterManifest(video, [silent]).offers.length, 0);
});

test('a video-local id is sent as a scoped variant handle, never in the SKU field', async () => {
  const row = carry();
  const out = await intake.resolveIntakeItem(row, deps({ pages: { [row.urls[0]]: inStock({ image_reference: 'https://cdn.shop/a.jpg' }) } }));
  const [offer] = intake.buildRosterManifest(video, [out]).offers;
  assert.equal(offer.sku, undefined);
  same([offer.variant_id, offer.identity_scope, offer.family], ['VR-n9u8ynhBdSo-4-main', 'video_local', 'Carryall bag']);
  assert.match(intake.renderIntakeReview(video, [out]), /video-local/);
  // A manufacturer code keeps travelling as a SKU.
  const burgundy = byTitle()['Side Trunk - Burgundy'];
  const coded = await intake.resolveIntakeItem(burgundy, deps({ pages: { [burgundy.urls[0]]: inStock({ image_reference: 'https://cdn.shop/r.jpg' }) } }));
  const [codedOffer] = intake.buildRosterManifest(video, [coded]).offers;
  same([codedOffer.sku, codedOffer.identity_scope, codedOffer.variant_id], ['M25669', undefined, undefined]);
});

test('a seller page that contradicts the row is rejected, and its photo is never a reference', async () => {
  const red20 = byTitle()['Speedy Bag Bandouliere - Red 20'];
  const [url] = red20.urls;
  const check = async meta => intake.resolveIntakeItem(red20, deps({ pages: { [url]: inStock({ image_reference: 'https://cdn.shop/wrong.jpg', ...meta }) } }));
  for (const [meta, reason] of [
    [{ title: 'Louis Vuitton Speedy P9 Bandouliere 40 Red' }, 'size_contradiction'],
    [{ title: 'Louis Vuitton Speedy P9 Bandouliere 20 Yellow' }, 'colour_contradiction'],
    [{ title: 'Louis Vuitton Alma BB Epi Leather Red 20' }, 'other_product'],
    [{ title: 'Speedy Bandouliere 20 Red', brand: 'Gucci' }, 'brand_contradiction'],
  ]) {
    const out = await check(meta);
    same(out.rejected_links.map(link => link.reason), [reason]);
    assert.equal(out.offers.length, 0);
    assert.equal(out.verified_image, null, reason);
    assert.equal(out.status, 'NEEDS_REVIEW');
    assert.ok(out.reasons.includes('links_rejected'));
  }
  const good = await check({ title: 'Louis Vuitton Calfskin Monogram Speedy P9 Bandouliere 20 Red' });
  assert.equal(good.status, 'READY', JSON.stringify(good.reasons));
  assert.equal(good.verified_image, 'https://cdn.shop/wrong.jpg');
});

test('removed and sold-out listings never become offers; a variant with nothing live is not READY', async () => {
  const row = carry();
  const [a, b] = row.urls;
  const sold = await intake.resolveIntakeItem(row, deps({ pages: {
    [a]: page({ resolution: 'unavailable', http_status: 404 }),
    [b]: page({ image_reference: 'https://cdn.shop/b.jpg', availability: 'https://schema.org/SoldOut' }),
  } }));
  assert.equal(sold.status, 'NEEDS_REVIEW');
  same(sold.reasons, ['offers_sold_out']);
  same(sold.offers.map(offer => offer.availability), ['sold_out']);
  assert.ok(sold.notes.includes('link_removed:fashionphile.com') && sold.notes.includes('offer_sold_out:poshmark.com'));
  // The sold listing's photo is still a real photo of this variant.
  assert.equal(sold.verified_image, 'https://cdn.shop/b.jpg');
  assert.equal(intake.buildRosterManifest(video, [sold]).offers.length, 0);
});

test('unstated, unsure and could-not-find rows are held for review even when their links work', async () => {
  const rows = byTitle();
  for (const [title, reason] of [['Speedy Bag Bandouliere - Red (size unstated)', 'variant_unstated'], ['Vagabond Hobo Bag - Brown', 'partner_unsure']]) {
    const row = rows[title];
    const out = await intake.resolveIntakeItem(row, deps({ pages: Object.fromEntries(row.urls.map(url => [url, inStock({ image_reference: 'https://cdn.shop/x.jpg' })])) }));
    assert.equal(out.status, 'NEEDS_REVIEW');
    same(out.reasons, [reason]);
  }
  const gap = await intake.resolveIntakeItem(rows['Neverfull Tote - Shearling'], deps());
  assert.ok(gap.reasons.includes('partner_could_not_find') && gap.reasons.includes('no_offer'));
  const unreachable = await intake.resolveIntakeItem(carry(), deps({ pages: Object.fromEntries(carry().urls.map(url => [url, page({ resolution: 'unavailable', http_status: 0 })])) }));
  same(unreachable.reasons, ['no_confirmed_offer', 'sellers_unreachable']);
});

test('a reseller’s own stock number does not contradict a manufacturer code the partner gave', async () => {
  const url = 'https://www.fashionphile.com/products/louis-vuitton-monogram-carryall-mm-1000003';
  const row = { index: 1, source_line: 'x', title: 'CarryAll MM', brand: 'Louis Vuitton', sku: 'M46197', gtin: null, object_type: 'bag', urls: [url], image_reference: null, price: null, timestamp_ms: null };
  const out = await intake.resolveIntakeItem(row, deps({ pages: { [url]: inStock({ sku: '1000003', image_reference: 'https://cdn.shop/c.jpg' }) } }));
  assert.equal(out.status, 'READY', JSON.stringify(out.reasons));
  // A page that states a different code is still refused.
  const other = await intake.resolveIntakeItem(row, deps({ pages: { [url]: inStock({ sku: 'M46987', image_reference: 'https://cdn.shop/c.jpg' }) } }));
  assert.ok(other.reasons.some(reason => reason.startsWith('link_sku_mismatch')));
});

test('a structure-only run checks nothing and can import nothing', () => {
  const items = parsed().items.map(intake.uncheckedIntakeItem);
  assert.ok(items.every(item => item.status === 'NEEDS_REVIEW' && item.reasons.includes('not_checked')));
  const video = { platform: 'youtube', content_ref: 'n9u8ynhBdSo' };
  assert.equal(intake.buildRosterManifest(video, items).offers.length, 0);
  const review = intake.renderIntakeReview(video, items);
  assert.match(review, /Structure only/);
  assert.match(review, /## 1\. Side Trunk/);
  assert.match(review, /Suggested SKU\(s\), not applied: M46197/);
  assert.match(review, /Link set aside, not used as offer or photo/);
});

test('the cleaned roster round-trips as a spreadsheet and keeps its identities', async () => {
  const items = parsed().items.map(intake.uncheckedIntakeItem);
  const csv = intake.renderIntakeCsv(items);
  const again = intake.parseRosterIntake(csv);
  assert.equal(again.layout, 'flat');
  same(again.items.map(item => item.sku), items.map(item => item.sku));
  same(again.items.map(item => item.urls), items.map(item => item.urls));
  // A video-local id read back from a sheet is still video-local: page SKUs do not reject its links.
  const red = again.items.find(item => item.title === 'Speedy Bag Bandouliere - Red 20');
  const out = await intake.resolveIntakeItem(red, deps({ pages: { [red.urls[0]]: inStock({ sku: '1000005', image_reference: 'https://cdn.shop/a.jpg' }) } }));
  assert.equal(out.sku_source, 'partner_group');
  assert.equal(out.status, 'READY', JSON.stringify(out.reasons));
});

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text, compress] of files) {
    const raw = Buffer.from(text, 'utf8');
    const data = compress ? deflateRawSync(raw) : raw;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(compress ? 8 : 0, 8);
    header.writeUInt32LE(crc32(raw), 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(Buffer.byteLength(name), 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(compress ? 8 : 0, 10);
    entry.writeUInt32LE(crc32(raw), 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(Buffer.byteLength(name), 28); entry.writeUInt32LE(offset, 42);
    parts.push(header, Buffer.from(name), data);
    central.push(entry, Buffer.from(name));
    offset += 30 + Buffer.byteLength(name) + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

test('a Word / Google Docs file is read directly: line breaks, real link targets, automatic numbering', () => {
  const run = text => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const numbered = text => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(text)}</w:p>`;
  const document = `<?xml version="1.0"?><w:document><w:body>`
    + `<w:p>${run('LV SKU FOR ')}<w:hyperlink r:id="rId1">${run('https://www.youtube.com/watch?v=n9u8ynhBdSo')}</w:hyperlink></w:p>`
    + numbered('Side Trunk')
    + `<w:p>${run('Black variant')}<w:r><w:br/></w:r><w:hyperlink r:id="rId2">${run('https://shop.co/trunk?a=1&amp;b…')}</w:hyperlink><w:r><w:br/></w:r><w:hyperlink r:id="rId3">${run('this one')}</w:hyperlink></w:p>`
    + numbered('CarryAll')
    + `<w:p><w:hyperlink r:id="rId3">${run('https://shop.co/carryall')}</w:hyperlink></w:p>`
    + `</w:body></w:document>`;
  const rels = `<Relationships><Relationship Id="rId1" Type="h" Target="https://www.youtube.com/watch?v=n9u8ynhBdSo" TargetMode="External"/>`
    + `<Relationship Id="rId2" Type="h" Target="https://shop.co/trunk?a=1&amp;b=2" TargetMode="External"/>`
    + `<Relationship Id="rId3" Type="h" Target="https://shop.co/carryall" TargetMode="External"/></Relationships>`;
  const numbering = `<w:numbering><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const text = docxToText(zip([['word/document.xml', document, true], ['word/_rels/document.xml.rels', rels, false], ['word/numbering.xml', numbering, true]]));
  same(text.split('\n'), [
    'LV SKU FOR https://www.youtube.com/watch?v=n9u8ynhBdSo', '1. Side Trunk', 'Black variant', 'https://shop.co/trunk?a=1&b=2', 'this one https://shop.co/carryall', '2. CarryAll', 'https://shop.co/carryall',
  ]);
  assert.throws(() => docxToText(Buffer.from('not a zip at all, just text')), /docx/);
});

test('CLI: a list that names its own video runs locally end to end without an API session', async () => {
  // Structure-only: reads the built API code, fetches nothing.
  const post = await localPoster({ fetchPages: false });
  const result = await runRosterIntake({ video: null, list: OUTLINE, post });
  same(result.video, { platform: 'youtube', content_ref: 'n9u8ynhBdSo' });
  assert.equal(result.summary.products, 15);
  assert.equal(result.summary.ready, 0);
  assert.equal(result.manifest.offers.length, 0);
  assert.match(result.roster_csv, /^section,family,variant label,/);
  await assert.rejects(() => post('/partner-roster', {}), /needs the API/);
  await assert.rejects(() => runRosterIntake({ video: null, list: 'Side Trunk M2A578\nCarryAll M46197', post }), /video URL or ID is required/);
});

test('CLI: resolve batches are bounded by links as well as by product count', () => {
  const items = [5, 5, 5, 8, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0].map((links, index) => ({ index, urls: Array.from({ length: links }, (_, i) => `https://s.shop/${index}/${i}`) }));
  const batches = chunkByLinks(items);
  assert.ok(batches.every(batch => batch.length <= 8 && (batch.length === 1 || batch.reduce((sum, item) => sum + Math.max(1, item.urls.length), 0) <= 16)));
  same(batches.flat().map(item => item.index), items.map(item => item.index));
  same(batches.map(batch => batch.length), [3, 8, 4]);
});

test('the server bounds a resolve request by links too, and loose numbers only count as headings in sequence', async () => {
  const heavy = Array.from({ length: 4 }, (_, index) => ({ index, source_line: 'x', title: 't', brand: 'b', sku: null, gtin: null, object_type: 'bag', image_reference: null, price: null, timestamp_ms: null, urls: Array.from({ length: 7 }, (_, i) => `https://s.shop/${index}/${i}`) }));
  await assert.rejects(() => intake.resolveRosterIntake(heavy, deps()), /at most 24 seller links/);
  const list = '1. Speedy\n25 Monogram version\nhttps://shop.co/a\n2 Neverfull\nBlack\nhttps://shop.co/b';
  same(intake.parseRosterIntake(list, { brand: 'LV' }).items.map(item => item.title), ['Speedy - 25 Monogram', 'Neverfull - Black']);
});

test('HTTP: parse takes the video from the list when none is sent, and manifest returns the spreadsheet', async () => {
  const env = { ADMIN_ACCESS_LEDGER: { idFromName: x => x, get: () => ({ fetch: async () => Response.json({ admin: true, admin_id: 'reviewer' }) }) } };
  const server = loadModule(new URL('../src/server.ts', import.meta.url).pathname, { fetch: async () => { throw new Error('no network in this test'); } });
  const post = body => server.default.fetch(new Request('https://api.scoop.shop/roster-intake', { method: 'POST', headers: { 'content-type': 'application/json', 'x-scoop-admin-session': 's' }, body: JSON.stringify(body) }), env);
  const parsedBody = await (await post({ action: 'parse', list: OUTLINE })).json();
  same(parsedBody.video, { platform: 'youtube', content_ref: 'n9u8ynhBdSo' });
  assert.equal(parsedBody.layout, 'outline');
  assert.equal(parsedBody.items.length, 15);
  const missing = await post({ action: 'parse', list: 'Side Trunk M2A578\nCarryAll M46197' });
  assert.equal(missing.status, 422);
  const built = await (await post({ action: 'manifest', video: 'n9u8ynhBdSo', items: parsedBody.items.map(intake.uncheckedIntakeItem) })).json();
  assert.match(built.roster_csv, /VR-n9u8ynhBdSo-1-black-with-gold-buckles/);
  assert.equal(built.manifest.offers.length, 0);
});

// ---- video-local identities stay scoped candidates through the resolver's own model ----

const mapping = loadModule(new URL('../src/verified-product-mapping.ts', import.meta.url).pathname);
const roster = loadModule(new URL('../src/partner-roster.ts', import.meta.url).pathname);
const memory = loadModule(new URL('../src/canonical-product-memory.ts', import.meta.url).pathname);
const replacement = loadModule(new URL('../src/roster-seed-replacement.ts', import.meta.url).pathname);
const learning = loadModule(new URL('../src/partner-learning.ts', import.meta.url).pathname);

const localRow = extra => ({
  platform: 'youtube', content_ref: 'n9u8ynhBdSo', scope: 'entire_video', object_type: 'bag', brand: 'Louis Vuitton',
  product_id: 'VR-n9u8ynhBdSo-4-main', variant_id: 'VR-n9u8ynhBdSo-4-main', identity_scope: 'video_local',
  title: 'Louis Vuitton Carryall bag', destination: 'https://www.fashionphile.com/products/louis-vuitton-monogram-carryall-mm-1000003',
  image_reference: 'https://cdn.shop/a.jpg', provider: 'fashionphile.com', provenance: 'admin_verified', ...extra,
});

test('a video-local id is only accepted declared, and only on its own video', () => {
  const parse = rows => mapping.parseVerifiedProductMappings(JSON.stringify(rows));
  assert.equal(parse([localRow()]).length, 1);
  assert.equal(parse([localRow()])[0].identity_scope, 'video_local');
  // Undeclared: would read as a manufacturer SKU. Dropped.
  assert.equal(parse([localRow({ identity_scope: undefined })]).length, 0);
  // Declared on a different video. Dropped.
  assert.equal(parse([localRow({ content_ref: 'AAAAAAAAAAA' })]).length, 0);
  // Declared without a video-local handle. Dropped.
  assert.equal(parse([localRow({ product_id: 'M46197', variant_id: 'M46197' })]).length, 0);
});

test('a video-local id never resolves from text, never shows as a model, never crosses videos', () => {
  const row = localRow({ scope: 'time_window', timestamp_start_ms: 0, timestamp_end_ms: 60000, variant_id: undefined });
  // Even as the only row for the moment, with its handle spoken in the description, text cannot resolve it.
  const hit = mapping.lookupVerifiedProductMapping({
    mappings: [row], platform: 'youtube', contentRef: 'n9u8ynhBdSo', timestampMs: 1000,
    description: { category: 'bag', subcategory: 'bag', brand_candidate: 'Louis Vuitton', model_candidate: 'VR-n9u8ynhBdSo-4-main', visible_text: ['VR-n9u8ynhBdSo-4-main'], logos_markings: [], distinctive_features: [], search_queries: [] },
  });
  assert.equal(hit, null);
  const product = mapping.verifiedMappingProduct(localRow());
  assert.equal(product.model, null);
  assert.equal(product.metadata.model, undefined);
  assert.match(product.identity_key, /^video-local:/);
  assert.ok(!product.verification_reasons.some(reason => /verified SKU/i.test(reason)));
  // The canonical identity carries the scope and is equivalent only to itself.
  const identity = memory.canonicalProductIdentity({ mapping: localRow(), model: null, merchantItemId: '1000003', verifiedAt: '2026-11-11T00:00:00.000Z' });
  assert.equal(identity.identity_scope, 'video_local');
  assert.equal(memory.isVideoLocalIdentity(identity), true);
  const elsewhere = memory.canonicalProductIdentity({ mapping: localRow({ content_ref: 'AAAAAAAAAAA', product_id: 'VR-AAAAAAAAAAA-4-main', variant_id: 'VR-AAAAAAAAAAA-4-main' }), model: null, merchantItemId: '1000003', verifiedAt: '2026-11-11T00:00:00.000Z' });
  assert.notEqual(identity.canonical_key, elsewhere.canonical_key);
  assert.equal(memory.canonicalProductsEquivalent(identity, elsewhere), false);
  // A stored row that lost the flag is still recognised by its handle.
  assert.equal(memory.isVideoLocalIdentity({ variant_id: 'VR-n9u8ynhBdSo-4-main' }), true);
  assert.equal(memory.isVideoLocalIdentity({ variant_id: 'M46197' }), false);
});

test('the importer refuses a video-local id disguised as a SKU or attached to another video', async () => {
  const offer = extra => ({ destination: 'https://shop.example.com/a', title: 'Carryall bag', brand: 'Louis Vuitton', object_type: 'bag', image_reference: 'https://cdn.shop/a.jpg', ...extra });
  const stored = new Map();
  const env = { VERIFIED_PRODUCT_LEDGER: { idFromName: x => x, get: () => ({ fetch: async () => Response.json({ accepted: true, image: { mimeType: 'image/png', data: 'AA==' } }) }) } };
  const prepare = (contentRef, offers) => learning.preparePartnerRoster(env, 'https://api.scoop.shop', { platform: 'youtube', content_ref: contentRef, offers },
    { metadata: async () => { throw new Error('explicit rows must not refetch pages'); }, image: async () => ({ mimeType: 'image/png', data: btoa('reference bytes') }) });
  // The declared, in-scope form is accepted and keeps its scope on the stored row.
  const [accepted] = await prepare('n9u8ynhBdSo', [offer({ variant_id: 'VR-n9u8ynhBdSo-4-main', identity_scope: 'video_local', supersedes: ['FP-1000003'] })]);
  same([accepted.mapping.identity_scope, accepted.mapping.supersedes, accepted.identity.identity_scope], ['video_local', ['FP-1000003'], 'video_local']);
  void stored;
  await assert.rejects(() => prepare('n9u8ynhBdSo', [offer({ sku: 'VR-n9u8ynhBdSo-4-main' })]), /never as a SKU/);
  await assert.rejects(() => prepare('n9u8ynhBdSo', [offer({ variant_id: 'VR-n9u8ynhBdSo-4-main' })]), /identity_scope/);
  await assert.rejects(() => prepare('AAAAAAAAAAA', [offer({ variant_id: 'VR-n9u8ynhBdSo-4-main', identity_scope: 'video_local' })]), /different video/);
  await assert.rejects(() => prepare('n9u8ynhBdSo', [offer({ sku: 'M46197', identity_scope: 'video_local' })]), /video-local/);
});

// ---- replacing hand-seeded rows without duplicates ----

const seed = extra => ({
  platform: 'youtube', content_ref: 'n9u8ynhBdSo', scope: 'entire_video', object_type: 'bag', brand: 'Louis Vuitton',
  product_id: 'FP-1000003', title: 'Louis Vuitton Monogram CarryAll MM', destination: 'https://www.fashionphile.com/products/louis-vuitton-monogram-carryall-mm-1000003',
  image_reference: 'https://cdn.shop/seed.jpg', provider: 'fashionphile.com', provenance: 'admin_verified',
  candidate_window_start_ms: 400000, candidate_window_end_ms: 500000,
  trusted_observations: [{ observed_at: '2026-10-07T00:00:00Z', source: 'creator', color: 'brown' }], ...extra,
});
const SEEDS = [
  seed(),
  seed({ product_id: 'M28392', title: 'Louis Vuitton Vagabond Hobo', destination: 'https://us.louisvuitton.com/p/M28392', candidate_window_start_ms: 161000, candidate_window_end_ms: 300000 }),
  seed({ product_id: 'FP-1999999', title: 'Louis Vuitton Monogram Speedy Bandouliere 25', destination: 'https://www.fashionphile.com/products/louis-vuitton-monogram-speedy-bandouliere-25-1999999', candidate_window_start_ms: 805000, candidate_window_end_ms: 955000 }),
  seed({ product_id: 'M46784', title: 'Louis Vuitton High Rise Bumbag', destination: 'https://us.louisvuitton.com/p/M46784' }),
];

async function resolvedRoster() {
  const rows = byTitle();
  const ready = async (title, image) => {
    const row = rows[title];
    return intake.resolveIntakeItem(row, deps({ pages: { [row.urls[0]]: inStock({ image_reference: image }) } }));
  };
  return [
    await ready('Carryall bag', 'https://cdn.shop/carry.jpg'),
    await ready('Speedy Bag Bandouliere - Red 20', 'https://cdn.shop/red20.jpg'),
    await ready('Speedy Bag Bandouliere - Red 40', 'https://cdn.shop/red40.jpg'),
    await intake.resolveIntakeItem(rows['Vagabond Hobo Bag - Brown'], deps()), // unsure, nothing confirmed: not READY
  ];
}

test('seed replacement plan: a seed is retired only by READY variants, and never without a named replacement', async () => {
  const items = await resolvedRoster();
  const plan = replacement.planSeedReplacement(video, items, SEEDS);
  assert.equal(plan.status, 'DRAFT_NOT_APPROVED');
  const entry = id => plan.entries.find(e => e.seed_product_id === id);
  // Same listing: evidence, no judgement needed.
  same([entry('FP-1000003').basis, entry('FP-1000003').action, entry('FP-1000003').needs_signoff, entry('FP-1000003').replaced_by], ['same_listing', 'supersede', false, ['VR-n9u8ynhBdSo-4-main']]);
  // Same manufacturer code, but the variant is not READY: the seed stays, coverage does not drop.
  same([entry('M28392').basis, entry('M28392').action, entry('M28392').replaced_by, entry('M28392').not_ready], ['same_code', 'keep_seed', [], ['M28392']]);
  // Family-only link: every READY variant of the family takes over, and it needs sign-off.
  same([entry('FP-1999999').basis, entry('FP-1999999').action, entry('FP-1999999').needs_signoff], ['family', 'supersede', true]);
  same(entry('FP-1999999').replaced_by, ['VR-n9u8ynhBdSo-5-red-20', 'VR-n9u8ynhBdSo-5-red-40']);
  // Nothing in the list for this seed: untouched.
  same([entry('M46784').basis, entry('M46784').action], ['none', 'keep_seed']);
  same(plan.summary, { seeds: 4, superseded: 2, kept: 2, active_after: 5, duplicates_after: 0 });
  assert.ok(plan.entries.every(e => /^[a-f0-9-]{8,}|.+/.test(e.seed_canonical_key) && e.seed_canonical_key));
});

test('a draft plan retires nothing; an applied plan retires exactly the named seeds and keeps their lineage', async () => {
  const items = await resolvedRoster();
  const plan = replacement.planSeedReplacement(video, items, SEEDS);
  const draft = replacement.rosterMappingsWithPlan(video, items, plan, { seeds: SEEDS });
  assert.ok(draft.length === 3 && draft.every(row => !row.supersedes));
  assert.equal(roster.supersededProductIds(draft, 'youtube', 'n9u8ynhBdSo').size, 0);

  const applied = replacement.rosterMappingsWithPlan(video, items, { ...plan, status: 'APPROVED', approved_by: 'reviewer' }, { seeds: SEEDS });
  // Rows survive the resolver's own parser unchanged in the fields that matter.
  const parsedRows = mapping.parseVerifiedProductMappings(JSON.stringify(applied));
  assert.equal(parsedRows.length, 3);
  const carryRow = parsedRows.find(row => row.product_id === 'VR-n9u8ynhBdSo-4-main');
  same([carryRow.identity_scope, carryRow.supersedes], ['video_local', ['FP-1000003']]);
  // The seed's discussion window carries over as a retrieval prior. Its observations are not copied:
  // that would be an identity merge, and the seed row itself is kept.
  same([carryRow.candidate_window_start_ms, carryRow.candidate_window_end_ms, carryRow.trusted_observations], [400000, 500000, undefined]);
  assert.ok(applied.every(row => !row.trusted_observations));
  const red20 = parsedRows.find(row => row.product_id === 'VR-n9u8ynhBdSo-5-red-20');
  same([red20.supersedes, red20.candidate_window_start_ms], [['FP-1999999'], 805000]);

  const superseded = roster.supersededProductIds(parsedRows, 'youtube', 'n9u8ynhBdSo');
  same([...superseded].sort(), ['fp-1000003', 'fp-1999999']);
  const seedRows = SEEDS.map(row => ({ mapping: row }));
  same(roster.withoutSuperseded(seedRows, superseded).map(row => row.mapping.product_id), ['M28392', 'M46784']);
  // Scoped to the content: the same rows retire nothing in another video.
  assert.equal(roster.supersededProductIds(parsedRows, 'youtube', 'AAAAAAAAAAA').size, 0);
  // A replacement with no loadable pixels cannot retire anything.
  assert.equal(roster.supersededProductIds(parsedRows.map(row => ({ ...row, reference_image_status: 'pending_partner_image' })), 'youtube', 'n9u8ynhBdSo').size, 0);
  // Removing the replacement brings the seed back.
  same(roster.withoutSuperseded(seedRows, roster.supersededProductIds([], 'youtube', 'n9u8ynhBdSo')).length, 4);
});
