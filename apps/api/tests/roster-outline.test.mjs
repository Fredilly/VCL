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
​​[https://poshmark.com/listing/East-West-Pochette-Metis-Monogram-Canvas-6a74a5771fa204c08712c202](https://poshmark.com/listing/East-West-Pochette-Metis-Monogram-Canvas-6a74a5771fa204c08712c202)
`;

const parsed = () => intake.parseRosterIntake(OUTLINE);
const byTitle = () => Object.fromEntries(parsed().items.map(item => [item.title, item]));

test('an outline becomes one roster row per variant the partner named, not one per line', () => {
  const result = parsed();
  assert.equal(result.layout, 'outline');
  assert.equal(result.video_url, 'https://www.youtube.com/watch?v=n9u8ynhBdSo');
  same(result.items.map(item => item.title), [
    'Side Trunk', 'Side Trunk - Burgundy', 'Side Trunk - Black with gold buckles', 'Side Trunk - Monogram Dunne',
    'Vagabond Hobo Bag - Brown', 'Neverfull Tote - Black badge', 'Neverfull Tote - Shearling',
    'Carryall bag', 'Carryall bag - Black', 'Speedy Bag Bandouliere - Red',
  ]);
  // Brand comes from the headings; the header line and side comments are not products.
  assert.ok(result.items.every(item => item.brand === 'Louis Vuitton' && item.object_type === 'bag'));
  assert.ok(result.warnings.some(warning => /Brand read from the headings/.test(warning)));
  assert.ok(!result.items.some(item => /search from the shopping|not sure|couldn|SKU FOR/i.test(item.title)));
  same(result.items.map(item => item.section), [1, 1, 1, 1, 2, 3, 3, 4, 4, 5]);
});

test('every link under a note is an offer of that variant; search pages and tracking never are', () => {
  const rows = byTitle();
  same(rows['Side Trunk'].urls, [
    'https://www.fashionphile.com/products/louis-vuitton-monogram-side-trunk-pm-1000001',
    'https://www.ebay.com/itm/900000000001',
    'https://poshmark.com/listing/Louis-Vuitton-Monogram-MM-SoftSide-Trunk-6ac9b3b1ebb1a50f2b94b217',
  ]);
  assert.ok(rows['Side Trunk'].hints.includes('search_page_ignored:1'));
  same(rows['Side Trunk'].remarks, ['This link is a search from the shopping platform.']);
  // A variant selector survives; tracking does not.
  same(rows['Carryall bag - Black'].urls, ['https://www.fashionphile.com/products/louis-vuitton-lambskin-carryall-vibe-mm-black-1000004?variant=58270709055791']);
  same(rows['Side Trunk - Burgundy'].urls, ['https://item.rakuten.co.jp/selecthouse/lv-m25669/']);
  // Markdown-wrapped links with zero-width characters in front are still links.
  assert.equal(rows['Speedy Bag Bandouliere - Red'].urls.length, 3);
  // Merchant listing ids are read for each link.
  assert.equal(rows['Side Trunk'].listing_ids['https://www.ebay.com/itm/900000000001'], 'EBAY-900000000001');
  assert.equal(rows['Side Trunk'].listing_ids[rows['Side Trunk'].urls[0]], 'FP-1000001');
  assert.equal(rows['Side Trunk'].listing_ids[rows['Side Trunk'].urls[2]], 'POSH-6ac9b3b1ebb1a50f2b94b217');
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
  assert.equal(rows['Vagabond Hobo Bag - Brown'].sku_basis, 'partner_group');
  same(rows['Vagabond Hobo Bag - Brown'].link_codes.map(entry => entry.code), ['M28392']);
  // No codes anywhere: stable, readable, scoped to this video.
  assert.equal(rows['Side Trunk - Black with gold buckles'].sku, 'VR-n9u8ynhBdSo-1-black-with-gold-buckles');
  assert.ok(outline.isGroupVariantId(rows['Speedy Bag Bandouliere - Red'].sku));
  // The same list for another video can never produce the same id.
  const other = intake.parseRosterIntake(OUTLINE, {}, { platform: 'youtube', content_ref: 'AAAAAAAAAAA' });
  assert.equal(other.items[2].sku, 'VR-AAAAAAAAAAA-1-black-with-gold-buckles');
  // Prose is never a SKU ("S-lock style fasteners", "SKU FOR <video>").
  assert.ok(!parsed().items.some(item => /^(fasteners|for)$/i.test(item.sku ?? '')));
});

test('partner remarks are kept as review flags instead of becoming products', () => {
  const rows = byTitle();
  same(rows['Vagabond Hobo Bag - Brown'].flags, ['partner_unsure']);
  same(rows['Neverfull Tote - Shearling'].flags, ['partner_could_not_find']);
  assert.equal(rows['Neverfull Tote - Shearling'].urls.length, 0);
  assert.ok(rows['Speedy Bag Bandouliere - Red'].hints.includes('sizes_mixed:20, 40'));
  // A listing whose own name does not mention the product is pointed out.
  assert.ok(rows['Speedy Bag Bandouliere - Red'].hints.includes('link_names_other_product:poshmark.com'));
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

test('a grouped variant is READY from the partner’s own links: each listing is an offer, each photo a reference', async () => {
  const red = byTitle()['Speedy Bag Bandouliere - Red'];
  const [a, b, c] = red.urls;
  const out = await intake.resolveIntakeItem(red, deps({ pages: {
    [a]: page({ sku: '1000005', title: 'Louis Vuitton Speedy P9 Bandouliere 20 Red', image_reference: 'https://cdn.shop/a.jpg', price: '9000', currency: 'USD', availability: 'InStock' }),
    [b]: page({ sku: '1000006', title: 'Louis Vuitton Speedy P9 Bandouliere 40 Red', image_reference: 'https://cdn.shop/b.jpg', availability: 'InStock' }),
    [c]: page({ resolution: 'unavailable', http_status: 403 }),
  } }));
  assert.equal(out.status, 'READY', JSON.stringify(out.reasons));
  assert.equal(out.sku_source, 'partner_group');
  // Seller stock numbers differ per listing; that never rejects a partner-grouped link.
  same(out.offers.map(offer => [offer.provider, offer.page, offer.seller_sku, offer.merchant_item_id]), [
    ['fashionphile.com', 'resolved', '1000005', '1000005'], ['fashionphile.com', 'resolved', '1000006', '1000006'], ['poshmark.com', 'blocked', null, '6a74a5771fa204c08712c202'],
  ]);
  const manifest = intake.buildRosterManifest({ platform: 'youtube', content_ref: 'n9u8ynhBdSo' }, [out]);
  assert.equal(manifest.offers.length, 3);
  assert.ok(manifest.offers.every(offer => offer.sku === 'VR-n9u8ynhBdSo-5-red' && offer.family === 'Speedy Bag Bandouliere' && offer.title === 'Speedy Bag Bandouliere - Red'));
  same(manifest.offers.map(offer => offer.image_reference), ['https://cdn.shop/a.jpg', 'https://cdn.shop/b.jpg', 'https://cdn.shop/a.jpg']);
  assert.match(intake.renderIntakeReview({ platform: 'youtube', content_ref: 'n9u8ynhBdSo' }, [out]), /video-local/);
});

test('removed and sold-out listings never become offers; a variant with nothing live is not READY', async () => {
  const red = byTitle()['Speedy Bag Bandouliere - Red'];
  const [a, b, c] = red.urls;
  const pages = {
    [a]: page({ resolution: 'unavailable', http_status: 404 }),
    [b]: page({ sku: '1000006', image_reference: 'https://cdn.shop/b.jpg', availability: 'SoldOut' }),
    [c]: page({ image_reference: 'https://cdn.shop/c.jpg', availability: 'InStock' }),
  };
  const out = await intake.resolveIntakeItem(red, deps({ pages }));
  assert.equal(out.status, 'READY');
  same(out.offers.map(offer => Boolean(offer.sold_out)), [true, false]);
  assert.ok(out.notes.includes('link_removed:fashionphile.com') && out.notes.includes('offer_sold_out:fashionphile.com'));
  const manifest = intake.buildRosterManifest({ platform: 'youtube', content_ref: 'v' }, [out]);
  same(manifest.offers.map(offer => offer.destination), [c]);
  // The sold listing's photo is still a real photo of this variant.
  assert.equal(out.verified_image, 'https://cdn.shop/b.jpg');

  const gone = await intake.resolveIntakeItem(red, deps({ pages: { ...pages, [c]: page({ image_reference: 'https://cdn.shop/c.jpg', availability: 'https://schema.org/OutOfStock' }) } }));
  assert.equal(gone.status, 'NEEDS_REVIEW');
  assert.ok(gone.reasons.includes('offers_sold_out'));
  assert.equal(intake.buildRosterManifest({ platform: 'youtube', content_ref: 'v' }, [gone]).offers.length, 0);
});

test('seller sites that cannot be reached at all are reported as that, not as a missing image', async () => {
  const red = byTitle()['Speedy Bag Bandouliere - Red'];
  const out = await intake.resolveIntakeItem(red, deps({ pages: Object.fromEntries(red.urls.map(url => [url, page({ resolution: 'unavailable', http_status: 0 })])) }));
  assert.equal(out.status, 'NEEDS_REVIEW');
  same(out.reasons, ['sellers_unreachable']);
  assert.ok(out.offers.every(offer => offer.page === 'unreachable'));
});

test('unsure and could-not-find notes hold a variant for review even when its links work', async () => {
  const rows = byTitle();
  const brown = rows['Vagabond Hobo Bag - Brown'];
  const pages = Object.fromEntries(brown.urls.map(url => [url, page({ image_reference: 'https://cdn.shop/x.jpg' })]));
  const out = await intake.resolveIntakeItem(brown, deps({ pages }));
  assert.equal(out.status, 'NEEDS_REVIEW');
  same(out.reasons, ['partner_unsure']);
  same(out.proposed_skus, [{ sku: 'M28392', support: 1, source: 'partner_link' }]);
  const gap = await intake.resolveIntakeItem(rows['Neverfull Tote - Shearling'], deps());
  assert.ok(gap.reasons.includes('partner_could_not_find') && gap.reasons.includes('no_offer'));
  assert.equal(gap.status, 'NEEDS_REVIEW');
});

test('a reseller’s own stock number does not contradict a manufacturer code the partner gave', async () => {
  const url = 'https://www.fashionphile.com/products/louis-vuitton-monogram-carryall-mm-1000003';
  const row = { index: 1, source_line: 'x', title: 'CarryAll MM', brand: 'Louis Vuitton', sku: 'M46197', gtin: null, object_type: 'bag', urls: [url], image_reference: null, price: null, timestamp_ms: null };
  const out = await intake.resolveIntakeItem(row, deps({ pages: { [url]: page({ sku: '1000003', image_reference: 'https://cdn.shop/c.jpg' }) } }));
  assert.equal(out.status, 'READY', JSON.stringify(out.reasons));
  // A page that states a different code is still refused.
  const other = await intake.resolveIntakeItem(row, deps({ pages: { [url]: page({ sku: 'M46987', image_reference: 'https://cdn.shop/c.jpg' }) } }));
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
});

test('the cleaned roster round-trips as a spreadsheet and keeps its identities', async () => {
  const items = parsed().items.map(intake.uncheckedIntakeItem);
  const csv = intake.renderIntakeCsv(items);
  const again = intake.parseRosterIntake(csv);
  assert.equal(again.layout, 'flat');
  same(again.items.map(item => item.sku), items.map(item => item.sku));
  same(again.items.map(item => item.urls), items.map(item => item.urls));
  // A video-local id read back from a sheet is still video-local: page SKUs do not reject its links.
  const red = again.items.find(item => item.title === 'Speedy Bag Bandouliere - Red');
  const out = await intake.resolveIntakeItem(red, deps({ pages: { [red.urls[0]]: page({ sku: '1000005', image_reference: 'https://cdn.shop/a.jpg' }) } }));
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
  assert.equal(result.summary.products, 10);
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
  assert.equal(parsedBody.items.length, 10);
  const missing = await post({ action: 'parse', list: 'Side Trunk M2A578\nCarryAll M46197' });
  assert.equal(missing.status, 422);
  const built = await (await post({ action: 'manifest', video: 'n9u8ynhBdSo', items: parsedBody.items.map(intake.uncheckedIntakeItem) })).json();
  assert.match(built.roster_csv, /VR-n9u8ynhBdSo-1-black-with-gold-buckles/);
  assert.equal(built.manifest.offers.length, 0);
});
