import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';
import { chunk, parseArgs, runRosterIntake } from '../../../tools/roster-intake.mjs';

const intake = loadModule(new URL('../src/roster-intake.ts', import.meta.url).pathname);
const learning = loadModule(new URL('../src/partner-learning.ts', import.meta.url).pathname);
const ledgerMod = loadModule(new URL('../src/verified-product-ledger.ts', import.meta.url).pathname);

// vm-context arrays/objects don't deepEqual host literals; compare by value.
const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));

// The kind of thing a creator actually sends: a pasted YouTube description.
const CHAOTIC_DESCRIPTION = `TOP 10 LV BAGS TO BUY RIGHT NOW!!
Follow me on Instagram https://instagram.com/handbagholic
Shop the video:

0:24 Side Trunk PM - style M2A578 https://eu.louisvuitton.com/eng-e1/products/side-trunk-pm-monogram-nvprod7890038v/M2A578
2:43 Vagabond Hobo (caramel) M28392
5:35 Neverfull MM
   https://reseller.shop/neverfull-mm-m46987
5:35 Neverfull MM Monogram Roses   $1,950
#4) 5:35 CarryAll MM SKU: M46197
• 6:42 NéoNoé MM black  https://ltk.app/abc  https://ebay.com/itm/123
Multipass M2A078
-----
music by someone https://soundcloud.com/x
`;

test('a chaotic pasted description becomes ordered products with SKUs, links and candidate windows', () => {
  const { items, warnings } = intake.parseRosterIntake(CHAOTIC_DESCRIPTION, { brand: 'Louis Vuitton' });
  const titles = items.map(item => item.title);
  assert.ok(titles.includes('Side Trunk PM'));
  assert.ok(titles.includes('Vagabond Hobo (caramel)'));
  assert.ok(titles.includes('Neverfull MM'));
  assert.ok(titles.includes('Neverfull MM Monogram Roses'));
  assert.ok(titles.includes('CarryAll MM'));
  assert.ok(titles.includes('Multipass'));
  const byTitle = Object.fromEntries(items.map(item => [item.title, item]));
  assert.equal(byTitle['Side Trunk PM'].sku, 'M2A578');
  assert.equal(byTitle['Side Trunk PM'].timestamp_ms, 24000);
  assert.equal(byTitle['Side Trunk PM'].urls.length, 1);
  assert.equal(byTitle['Vagabond Hobo (caramel)'].sku, 'M28392');
  assert.equal(byTitle['CarryAll MM'].sku, 'M46197');
  assert.equal(byTitle['Multipass'].sku, 'M2A078');
  // A bare link line belongs to the product above it.
  same(byTitle['Neverfull MM'].urls, ['https://reseller.shop/neverfull-mm-m46987']);
  assert.equal(byTitle['Neverfull MM Monogram Roses'].price, '$1,950');
  // Social links never become products or offers.
  assert.ok(items.every(item => item.urls.every(url => !/instagram|soundcloud/.test(url))));
  assert.ok(!titles.some(title => /instagram|music by/i.test(title ?? '')));
  assert.ok(warnings.some(w => /non-product link/.test(w)));
  // Defaults and inferred types apply; windows run until the next listed time.
  assert.ok(items.every(item => item.brand === 'Louis Vuitton'));
  assert.equal(byTitle['Side Trunk PM'].object_type, 'bag');
  assert.equal(byTitle['Side Trunk PM'].candidate_window_end_ms, 163000 - 1);
  assert.equal(byTitle['Multipass'].candidate_window_start_ms, undefined);
});

test('spreadsheet exports with any common headers, quoted commas and several link columns', () => {
  const csv = [
    'Product Name,Style Code,Brand,Seller Link,Backup URL,Image,Time',
    '"Speedy Bandoulière 25, monogram",M46977,Louis Vuitton,https://us.louisvuitton.com/p/M46977,https://reseller.shop/speedy-25,https://img.example.com/speedy.jpg,13:25',
    'High Rise Bumbag,M46784,Louis Vuitton,,,,12:24',
  ].join('\n');
  const { items } = intake.parseRosterIntake(csv);
  assert.equal(items.length, 2);
  const speedy = items.find(item => item.sku === 'M46977');
  assert.equal(speedy.title, 'Speedy Bandoulière 25, monogram');
  assert.equal(speedy.urls.length, 2);
  assert.equal(speedy.image_reference, 'https://img.example.com/speedy.jpg');
  assert.equal(speedy.timestamp_ms, 805000);
  assert.equal(speedy.object_type, 'bag');
  // Sorted windows: High Rise (12:24) ends before Speedy (13:25) starts.
  assert.equal(items.find(item => item.sku === 'M46784').candidate_window_end_ms, 805000 - 1);
});

test('JSON lists and plain link dumps are accepted; duplicate SKUs merge', () => {
  const { items, warnings } = intake.parseRosterIntake({ products: [
    { name: 'Trunkie', sku: 'M14526', links: ['https://a.shop/trunkie', { url: 'https://b.shop/trunkie' }], brand: 'Louis Vuitton' },
    { title: 'Trunkie again', sku: 'M14526', url: 'https://c.shop/trunkie' },
    'Vanity Chain Pouch M47125 https://d.shop/vanity',
  ] });
  assert.equal(items.length, 2);
  assert.equal(items[0].urls.length, 3);
  assert.equal(items[1].sku, 'M47125');
  assert.ok(warnings.some(w => /duplicate/.test(w)));
  const links = intake.parseRosterIntake('https://x.shop/product-1\nhttps://x.shop/product-2');
  assert.equal(links.items.length, 2);
});

test('product codes match whole tokens only, never a longer code that contains them', () => {
  assert.equal(intake.textCarriesCode('LOUIS VUITTON CarryAll MM Monogram M46197 Tote', 'M46197'), true);
  assert.equal(intake.textCarriesCode('Louis Vuitton bag M461970 monogram', 'M46197'), false);
  assert.equal(intake.textCarriesCode('Kith cap KHMA050113 001 black', 'KHMA050113-001'), true);
  assert.equal(intake.textCarriesCode('nice bag', 'M46'), false);
  same(intake.codeTokens('Speedy 25 MM 1080P M2A038 1WS-1916 bag'), ['M2A038', '1WS-1916']);
});

test('video references: YouTube URLs, short links, shorts and bare IDs', () => {
  for (const value of ['https://www.youtube.com/watch?v=n9u8ynhBdSo&t=30', 'https://youtu.be/n9u8ynhBdSo', 'https://youtube.com/shorts/n9u8ynhBdSo', 'n9u8ynhBdSo']) {
    same(intake.parseVideoRef(value), { platform: 'youtube', content_ref: 'n9u8ynhBdSo' });
  }
  assert.throws(() => intake.parseVideoRef('not a video'), /video/i);
});

const lvPage = { sku: 'M46197', variant_id: null, title: 'CarryAll MM', brand: 'Louis Vuitton', object_type: 'bag', canonical_url: null, image_reference: 'https://img.lv.com/M46197.jpg', price: '3050.00', currency: 'USD', resolution: 'resolved' };
const hit = (title, destination, extra = {}) => ({ id: destination.split('/').pop(), title, brand: 'Louis Vuitton', model: null, category: 'bag', image_reference: `${destination}.jpg`, provenance: 'ebay', provider: 'ebay', destination, price: '1200', currency: 'USD', result_class: 'SIMILAR', ...extra });
function deps({ pages = {}, hits = [], loads = () => true } = {}) {
  const calls = { search: 0, metadata: 0 };
  return {
    calls,
    metadata: async url => { calls.metadata++; return pages[url] ?? null; },
    imageLoads: async url => loads(url),
    search: async () => { calls.search++; return hits; },
  };
}
const item = overrides => ({ index: 1, source_line: 'x', title: 'CarryAll MM', brand: 'Louis Vuitton', sku: null, gtin: null, object_type: 'bag', urls: [], image_reference: null, price: null, timestamp_ms: null, ...overrides });

test('a seller link whose page lists the SKU is READY without spending search quota', async () => {
  const d = deps({ pages: { 'https://us.louisvuitton.com/p/M46197': lvPage } });
  const out = await intake.resolveIntakeItem(item({ urls: ['https://us.louisvuitton.com/p/M46197'] }), d);
  assert.equal(out.status, 'READY');
  assert.equal(out.sku, 'M46197');
  assert.equal(out.verified_image, 'https://img.lv.com/M46197.jpg');
  assert.equal(out.offers[0].source, 'partner_link');
  assert.equal(out.sku_source, 'merchant_page');
  assert.equal(d.calls.search, 0);
});

test('a SKU read off one seller page stays namespaced; other sellers with that code are proposals, not merged offers', async () => {
  const page = { ...lvPage, variant_id: 'merchant:shop.co:M46197:||', image_reference: null };
  const d = deps({ pages: { 'https://shop.co/carryall': page }, hits: [hit('LOUIS VUITTON CarryAll MM M46197', 'https://www.ebay.com/itm/1')] });
  const out = await intake.resolveIntakeItem(item({ urls: ['https://shop.co/carryall'] }), d);
  assert.equal(out.sku, 'merchant:shop.co:M46197:||');
  assert.equal(out.sku_source, 'merchant_page');
  same(out.offers.map(offer => offer.source), ['partner_link']);
  same(out.proposed_skus, [{ sku: 'M46197', support: 2 }]);
  assert.equal(out.review_candidates[0].destination, 'https://www.ebay.com/itm/1');
  // No seller image and the lookalike's image is not borrowed.
  assert.ok(out.reasons.includes('image_missing'));
});

test('a seller page that lists a different SKU is never used for that product', async () => {
  const d = deps({ pages: { 'https://reseller.shop/x': { ...lvPage, sku: 'M46203' } } });
  const out = await intake.resolveIntakeItem(item({ sku: 'M46197', urls: ['https://reseller.shop/x'] }), d);
  assert.equal(out.offers.length, 0);
  assert.ok(out.reasons.some(reason => reason.startsWith('link_sku_mismatch')));
  assert.notEqual(out.status, 'READY');
});

test('with only a SKU, marketplace listings carrying that SKU become offers; lookalikes stay review-only', async () => {
  const d = deps({ hits: [
    hit('LOUIS VUITTON CarryAll MM Monogram M46197 shoulder bag', 'https://www.ebay.com/itm/1'),
    hit('Louis Vuitton CarryAll MM Monogram tote (no code)', 'https://www.ebay.com/itm/2'),
    hit('Louis Vuitton CarryAll PM M46203', 'https://www.ebay.com/itm/3'),
  ] });
  const out = await intake.resolveIntakeItem(item({ sku: 'M46197' }), d);
  assert.equal(out.status, 'READY');
  same(out.offers.map(offer => offer.destination), ['https://www.ebay.com/itm/1']);
  assert.equal(out.offers[0].source, 'sku_search');
  assert.equal(out.verified_image, 'https://www.ebay.com/itm/1.jpg');
  same(out.review_candidates.map(c => c.destination), ['https://www.ebay.com/itm/2', 'https://www.ebay.com/itm/3']);
});

test('a name with no SKU gets proposals from agreeing listings but is never READY', async () => {
  const d = deps({ hits: [
    hit('Louis Vuitton CarryAll MM Monogram M46197', 'https://www.ebay.com/itm/1'),
    hit('LV CarryAll MM monogram canvas M46197 full set', 'https://www.ebay.com/itm/2'),
    hit('Louis Vuitton Neverfull MM M46987', 'https://www.ebay.com/itm/3'),
  ] });
  const out = await intake.resolveIntakeItem(item({}), d);
  assert.equal(out.status, 'NEEDS_REVIEW');
  same(out.proposed_skus, [{ sku: 'M46197', support: 2 }]);
  assert.equal(out.offers.length, 0);
  assert.ok(out.reasons.includes('sku_missing_proposal_needs_review'));
});

test('no loadable reference image means not READY: the verifier needs pixels', async () => {
  const d = deps({ pages: { 'https://us.louisvuitton.com/p/M46197': lvPage }, loads: () => false });
  const out = await intake.resolveIntakeItem(item({ urls: ['https://us.louisvuitton.com/p/M46197'] }), d);
  assert.equal(out.status, 'NEEDS_REVIEW');
  assert.ok(out.reasons.includes('image_unavailable'));
  assert.equal(out.verified_image, null);
});

test('nothing found at all is UNRESOLVED, not guessed', async () => {
  const out = await intake.resolveIntakeItem(item({ brand: null, title: 'mystery bag' }), deps());
  assert.equal(out.status, 'UNRESOLVED');
  assert.ok(out.reasons.includes('sku_missing'));
  assert.ok(out.reasons.includes('no_offer'));
});

test('manifest imports only READY rows, and the strict partner-roster importer accepts it', async () => {
  const pages = { 'https://us.louisvuitton.com/p/M46197': lvPage };
  const d = deps({ pages, hits: [hit('LV CarryAll MM M46197', 'https://www.ebay.com/itm/9')] });
  const { items } = intake.parseRosterIntake('0:10 CarryAll MM M46197 https://us.louisvuitton.com/p/M46197\n1:00 Mystery bag', { brand: 'Louis Vuitton' });
  const resolved = await intake.resolveRosterIntake(items, d);
  assert.equal(resolved[0].status, 'READY');
  assert.notEqual(resolved[1].status, 'READY');
  const manifest = intake.buildRosterManifest({ platform: 'youtube', content_ref: 'video-A' }, resolved);
  assert.equal(manifest.offers.length, 1);
  assert.equal(manifest.offers[0].sku, 'M46197');
  assert.equal(manifest.offers[0].candidate_window_start_ms, 10000);
  assert.equal(manifest.offers[0].candidate_window_end_ms, 59999);

  const review = intake.renderIntakeReview({ platform: 'youtube', content_ref: 'video-A' }, resolved);
  assert.match(review, /1 of 2 products ready to import/);
  assert.match(review, /Needs attention/);

  // Feed the harness output straight into the existing importer.
  const values = new Map();
  const storage = {
    get: async key => values.get(key), put: async (key, value) => values.set(key, value), delete: async key => values.delete(key),
    list: async ({ prefix, limit } = {}) => new Map([...values].filter(([key]) => !prefix || key.startsWith(prefix)).slice(0, limit)),
    transaction: async operation => operation(storage),
  };
  const ledger = new ledgerMod.VerifiedProductLedger({ storage });
  const env = { VERIFIED_PRODUCT_LEDGER: { idFromName: x => x, get: () => ({ fetch: (url, options) => ledger.fetch(new Request(url, options)) }) } };
  const rows = await learning.preparePartnerRoster(env, 'https://api.scoop.shop', manifest, {
    metadata: async () => { throw new Error('explicit rows must not refetch pages'); },
    image: async () => ({ mimeType: 'image/png', data: btoa('reference') }),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].identity.variant_id, 'M46197');
  assert.equal(rows[0].mapping.candidate_window_start_ms, 10000);
});

test('resolve requests are bounded', async () => {
  const items = Array.from({ length: 9 }, (_, i) => item({ index: i + 1 }));
  await assert.rejects(() => intake.resolveRosterIntake(items, deps()), /at most 8/);
});

test('CLI orchestration: parse once, resolve in batches of 8, import READY offers in batches of 6', async () => {
  same(parseArgs(['n9u8ynhBdSo', 'list.txt', '--brand', 'Louis Vuitton', '--import']).brand, 'Louis Vuitton');
  assert.throws(() => parseArgs(['only-video']), /Usage/);
  same(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  const calls = [];
  const parsedItems = Array.from({ length: 10 }, (_, i) => ({ index: i + 1 }));
  const offers = Array.from({ length: 7 }, (_, i) => ({ destination: `https://s.shop/${i}` }));
  const post = async (path, body) => {
    calls.push(`${path}:${body.action ?? body.offers.length}`);
    if (body.action === 'parse') return { items: parsedItems, warnings: [] };
    if (body.action === 'resolve') return { items: body.items.map(row => ({ ...row, status: 'READY' })) };
    if (body.action === 'manifest') return { video: { platform: 'youtube', content_ref: 'v' }, summary: { ready: 10 }, manifest: { platform: 'youtube', content_ref: 'v', offers }, review_markdown: '# r' };
    return { accepted: true, distinct_variants: body.offers.length };
  };
  const result = await runRosterIntake({ video: 'v', list: 'x', importReady: true, post });
  same(calls, ['/roster-intake:parse', '/roster-intake:resolve', '/roster-intake:resolve', '/roster-intake:manifest', '/partner-roster:6', '/partner-roster:1']);
  assert.equal(result.items.length, 10);
  assert.equal(result.imported.merchant_offers, 7);
});

test('HTTP: /roster-intake requires an admin session and runs parse -> resolve -> manifest', async () => {
  const env = { ADMIN_ACCESS_LEDGER: { idFromName: x => x, get: () => ({ fetch: async () => Response.json({ admin: true, admin_id: 'reviewer' }) }) } };
  const page = `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'CarryAll MM', sku: 'M46197', brand: { '@type': 'Brand', name: 'Louis Vuitton' }, image: 'https://images.shop/M46197.png', offers: { '@type': 'Offer', price: '3050', priceCurrency: 'USD', url: 'https://catalog.shop/carryall' } })}</script></html>`;
  let server;
  const mockFetch = async (url, options) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === 'api.scoop.shop') return server.default.fetch(new Request(url, options), env);
    if (parsed.hostname === 'catalog.shop') return new Response(page, { headers: { 'content-type': 'text/html' } });
    if (parsed.hostname === 'images.shop') return new Response('png bytes', { headers: { 'content-type': 'image/png' } });
    throw new Error(`Unexpected fetch: ${parsed.hostname}`);
  };
  server = loadModule(new URL('../src/server.ts', import.meta.url).pathname, { fetch: mockFetch });
  const post = (body, admin = true) => server.default.fetch(new Request('https://api.scoop.shop/roster-intake', { method: 'POST', headers: { 'content-type': 'application/json', ...(admin ? { 'x-scoop-admin-session': 'test-session' } : {}) }, body: JSON.stringify(body) }), env);

  const denied = await post({ action: 'parse', video: 'n9u8ynhBdSo', list: 'x' }, false);
  assert.equal(denied.status, 401);

  const parsed = await (await post({ action: 'parse', video: 'https://youtu.be/n9u8ynhBdSo', list: '5:35 CarryAll MM M46197 https://catalog.shop/carryall', defaults: { object_type: 'bag' } })).json();
  assert.equal(parsed.video.content_ref, 'n9u8ynhBdSo');
  assert.equal(parsed.items.length, 1);

  const resolvedResponse = await post({ action: 'resolve', video: 'n9u8ynhBdSo', items: parsed.items });
  assert.equal(resolvedResponse.status, 200);
  const resolved = await resolvedResponse.json();
  assert.equal(resolved.items[0].status, 'READY', JSON.stringify(resolved.items[0].reasons));
  assert.equal(resolved.items[0].sku, 'M46197');

  const built = await (await post({ action: 'manifest', video: 'n9u8ynhBdSo', items: resolved.items })).json();
  assert.equal(built.summary.ready, 1);
  assert.equal(built.manifest.offers[0].destination, 'https://catalog.shop/carryall');
  assert.equal(built.manifest.offers[0].candidate_window_start_ms, 335000);
  assert.match(built.review_markdown, /1 of 1 products ready/);
});

// --- Arbitrary brands and categories -------------------------------------
// The harness must not assume a handbag video, a Louis Vuitton roster or a
// YouTube URL. These cases use other categories, other brands and other hosts.

test('product type inference is not handbag-specific', () => {
  const { items } = intake.parseRosterIntake([
    'Kith cap KHMA050113-001',
    'Mizzen+Main shirt 1WS-1916',
    'Nike sneakers DD1391-100',
    'Hermès silk scarf H123456',
    'West Elm chair 12345678',
    'Sony headphones WH-1000XM5',
    'Ceramic mug 98765432',
  ].join('\n'));
  const bySku = Object.fromEntries(items.map(row => [row.sku, row.object_type]));
  assert.equal(bySku['KHMA050113-001'], 'cap');
  assert.equal(bySku['1WS-1916'], 'shirt');
  assert.equal(bySku['DD1391-100'], 'sneakers');
  assert.equal(bySku['H123456'], 'scarf');
  assert.equal(bySku['12345678'], 'chair');
  assert.equal(bySku['WH-1000XM5'], 'headphones');
  assert.equal(bySku['98765432'], 'mug');
});

test('all-digit article numbers and non-USD prices are read without a brand hint', () => {
  const { items } = intake.parseRosterIntake([
    '1. Cuir sneaker 12345678 1.299,00 €',
    '2. Silk sari 98765432 ₹12,499',
    '3. Leather belt 11223344 GBP 89.99',
    '4. Linen shirt 55667788 1499 SEK',
  ].join('\n'));
  assert.equal(items.length, 4);
  const bySku = Object.fromEntries(items.map(row => [row.sku, row]));
  assert.equal(bySku['12345678'].price, '1.299,00 €');
  assert.equal(bySku['98765432'].price, '₹12,499');
  assert.equal(bySku['11223344'].price, 'GBP 89.99');
  assert.equal(bySku['55667788'].price, '1499 SEK');
  assert.ok(items.every(row => !/\d/.test(row.title ?? '')), 'prices and codes stay out of titles');
});

test('video references are not YouTube-only', () => {
  same(intake.parseVideoRef('https://vimeo.com/123456789'), { platform: 'vimeo.com', content_ref: 'https://vimeo.com/123456789' });
  same(intake.parseVideoRef('https://www.tiktok.com/@creator/video/7300000000'), { platform: 'tiktok.com', content_ref: 'https://www.tiktok.com/@creator/video/7300000000' });
  same(intake.parseVideoRef('instagram-reel-42', { platform: 'instagram' }), { platform: 'instagram', content_ref: 'instagram-reel-42' });
});

test('intro and chapter rows are dropped from a plain numbered list', () => {
  const { items, warnings } = intake.parseRosterIntake([
    'MY FAVORITE THINGS 2026!!',
    '0:00 Intro',
    '1. Ceramic mug 98765432',
    '2. Wool scarf H123456',
    '3. Oak chair 12345678',
  ].join('\n'));
  same(items.map(row => row.title), ['Ceramic mug', 'Wool scarf', 'Oak chair']);
  assert.ok(warnings.some(w => /intro text/.test(w)));
});

test('the same link twice is one product even without a SKU', () => {
  const { items, warnings } = intake.parseRosterIntake([
    'https://shop.example.com/p/1',
    'https://shop.example.com/p/1',
    'https://shop.example.com/p/2',
  ].join('\n'));
  assert.equal(items.length, 2);
  assert.ok(warnings.some(w => /duplicate/.test(w)));
});

test('nested JSON exports are accepted', () => {
  const { items } = intake.parseRosterIntake({
    data: { products: [{ title: 'Linen shirt', sku: 'SH-1001', url: 'https://shop.example.com/shirt' }] },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].sku, 'SH-1001');
  assert.equal(items[0].object_type, 'shirt');
});

test('a non-bag product resolves through a seller page with no category assumptions', async () => {
  const shoePage = {
    sku: 'DD1391-100', variant_id: null, title: 'Nike Dunk Low Retro', brand: 'Nike',
    object_type: 'sneakers', canonical_url: null, image_reference: 'https://img.shop/DD1391-100.jpg',
    price: '110.00', currency: 'USD', resolution: 'resolved',
  };
  const d = deps({ pages: { 'https://shop.example.com/dunk': shoePage } });
  const out = await intake.resolveIntakeItem(item({
    title: 'Nike Dunk Low Retro', brand: 'Nike', object_type: 'sneakers', urls: ['https://shop.example.com/dunk'],
  }), d);
  assert.equal(out.status, 'READY');
  assert.equal(out.sku, 'DD1391-100');
  assert.equal(out.verified_image, 'https://img.shop/DD1391-100.jpg');
  assert.equal(out.offers[0].provider, 'shop.example.com');
});

test('exports with unrecognised headers are read as free text instead of dropped', () => {
  const csv = [
    'Produkt;Artikelnummer;Preis;Link',
    'Sneaker;DD1391-100;110 EUR;https://shop.example.com/dunk',
    'Beanie;KHMA050113-001;35 EUR;https://shop.example.com/cap',
  ].join('\n');
  const { items } = intake.parseRosterIntake(csv);
  assert.equal(items.length, 2);
  assert.equal(items[0].sku, 'DD1391-100');
  assert.equal(items[0].price, '110 EUR');
  assert.equal(items[0].urls[0], 'https://shop.example.com/dunk');
  assert.equal(items[0].object_type, 'sneakers');
  assert.equal(items[1].sku, 'KHMA050113-001');
  assert.equal(items[1].object_type, 'cap');
});
