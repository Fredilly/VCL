import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';
const catalog = loadModule(new URL('../src/partner-catalog.ts', import.meta.url).pathname);
const html = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const variant = (sku, color, size = 'small') => ({ '@type': 'Product', sku, name: `Orbit ${color} bag`, color, size,
  image: `https://images.shop/${sku}-${color}.png`, offers: { '@type': 'Offer', url: `https://catalog.shop/bag?color=${color}&size=${size}`, price: '42', priceCurrency: 'USD' } });
const group = { '@type': 'ProductGroup', name: 'Orbit', productGroupID: 'orbit', brand: { name: 'Acme' },
  category: 'bag', material: 'canvas', image: 'https://images.shop/generic-hero.png',
  hasVariant: [variant('A', 'brown'), variant('B', 'white'), variant('C', 'white', 'large')] };

test('linked variant wins over first Product, group hero and tracking/order noise', () => {
  for (const data of [group, { ...group, hasVariant: [...group.hasVariant].reverse() }]) {
    const result = catalog.extractPartnerCatalogMetadata(html(data), 'https://catalog.shop/bag?utm_source=creator&size=large&color=white');
    assert.equal(result.sku, 'C');
    assert.equal(result.brand, 'Acme');
    assert.equal(result.family, 'orbit');
    assert.equal(result.object_type, 'bag');
    assert.equal(result.image_reference, 'https://images.shop/C-white.png');
    assert.equal(result.resolution, 'resolved');
  }
});

test('ambiguous groups and unrecognized variant selectors never pick a default product', () => {
  for (const url of ['https://catalog.shop/bag', 'https://catalog.shop/bag?color=white', 'https://catalog.shop/bag?variant=missing']) {
    const result = catalog.extractPartnerCatalogMetadata(html(group), url);
    assert.equal(result.resolution, 'ambiguous');
    assert.equal(result.sku, null);
    assert.equal(result.image_reference, null);
  }
  const plain = { ...variant('A', 'brown'), url: 'https://catalog.shop/bag', offers: undefined };
  assert.equal(catalog.extractPartnerCatalogMetadata(html(plain), 'https://catalog.shop/bag?variant=B').resolution, 'ambiguous');
});

test('flat graph references inherit group metadata but never borrow its image', () => {
  const parent = { ...group, '@id': '#family', hasVariant: [{ '@id': '#white' }, { '@id': '#brown' }] };
  const white = { ...variant('B', 'white'), '@id': '#white', isVariantOf: { '@id': '#family' } };
  const brown = { ...variant('A', 'brown'), '@id': '#brown', isVariantOf: { '@id': '#family' } };
  let result = catalog.extractPartnerCatalogMetadata(html({ '@graph': [parent, white, brown] }), 'https://catalog.shop/bag?color=white&size=small');
  assert.equal(result.brand, 'Acme');
  assert.equal(result.sku, 'B');
  delete white.image;
  result = catalog.extractPartnerCatalogMetadata(html({ '@graph': [parent, white, brown] }), 'https://catalog.shop/bag?color=white&size=small');
  assert.equal(result.image_reference, null);
});

test('merchant-local SKU collisions and same-SKU size/color variants stay distinct', () => {
  const ids = [];
  for (const host of ['one.shop', 'two.shop']) for (const color of ['white', 'brown']) {
    const product = { ...variant('LOCAL-1', color), brand: 'Acme', offers: { url: `https://${host}/item?color=${color}` } };
    ids.push(catalog.extractPartnerCatalogMetadata(html(product), product.offers.url).variant_id);
  }
  assert.equal(new Set(ids).size, 4);
});

test('same validated GTIN merges catalog identity across merchants; invalid GTIN does not', () => {
  const ids = ['one.shop', 'two.shop'].map(host => catalog.extractPartnerCatalogMetadata(html({
    ...variant('LOCAL-1', 'white'), gtin13: '4006381333931', brand: 'Acme', offers: { url: `https://${host}/item` },
  }), `https://${host}/item`).variant_id);
  assert.equal(ids[0], ids[1]);
  assert.ok(ids[0].startsWith('gtin:'));
  const invalid = catalog.extractPartnerCatalogMetadata(html({ ...variant('LOCAL-1', 'white'), gtin13: '4006381333932' }), 'https://catalog.shop/bag?color=white&size=small');
  assert.ok(invalid.variant_id.startsWith('merchant:'));
});

test('public short links hydrate selected metadata; redirect to private hosts is blocked before fetch', async () => {
  const calls = [];
  let result = await catalog.fetchPartnerCatalogMetadata('https://links.shop/item', async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'manual');
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://catalog.shop/bag?color=white&size=small' } })
      : new Response(html(group), { headers: { 'content-type': 'text/html' } });
  });
  assert.equal(result.sku, 'B');
  assert.equal(calls.length, 2);
  calls.length = 0;
  result = await catalog.fetchPartnerCatalogMetadata('https://links.shop/item', async url => {
    calls.push(url);
    return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
  });
  assert.equal(result.resolution, 'unavailable');
  assert.equal(calls.length, 1);
});

test('URL identity preserves path case and every unknown selection parameter', () => {
  assert.notEqual(catalog.catalogUrlKey('https://catalog.shop/Ab?edition=X'), catalog.catalogUrlKey('https://catalog.shop/ab?edition=X'));
  assert.notEqual(catalog.catalogUrlKey('https://catalog.shop/Ab?edition=X'), catalog.catalogUrlKey('https://catalog.shop/Ab?edition=Y'));
});
