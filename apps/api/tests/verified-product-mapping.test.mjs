import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mod = loadModule(resolve(here, '../src/verified-product-mapping.ts'));

const fixture = JSON.stringify([{
  platform: 'youtube',
  content_ref: 'TEST_VIDEO_ID',
  scope: 'entire_video',
  object_type: 'shirt',
  brand: 'Nike',
  product_id: 'DX1234-100',
  title: 'Nike Example Shirt',
  destination: 'https://www.nike.com/',
  provenance: 'test_fixture',
}]);

const shirt = {
  category: 'apparel',
  subcategory: 'button-down shirt',
  brand_candidate: null,
  model_candidate: null,
  color: 'blue',
  material: '',
  style_attributes: ['long sleeve'],
  visible_text: [],
  logos_markings: [],
  distinctive_features: [],
  hardware_details: [],
  shape_silhouette: [],
  search_terms: ['blue button-down shirt'],
  confidence: 0.9,
  identity_confidence: 0.1,
};

test('test fixture hits only for matching video + compatible object in benchmark mode', () => {
  const hit = mod.lookupVerifiedProductMapping({
    rawRegistry: fixture,
    allowTestFixtures: true,
    platform: 'youtube',
    contentRef: 'TEST_VIDEO_ID',
    description: shirt,
  });
  assert.equal(hit?.product_id, 'DX1234-100');
  assert.equal(mod.verifiedMappingProduct(hit).result_class, 'EXACT');
});

test('test fixture is disabled outside benchmark mode', () => {
  assert.equal(mod.lookupVerifiedProductMapping({
    rawRegistry: fixture,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'TEST_VIDEO_ID',
    description: shirt,
  }), null);
});

test('wrong object in same video misses and falls through', () => {
  assert.equal(mod.lookupVerifiedProductMapping({
    rawRegistry: fixture,
    allowTestFixtures: true,
    platform: 'youtube',
    contentRef: 'TEST_VIDEO_ID',
    description: { ...shirt, category: 'electronics', subcategory: 'microphone', search_terms: ['podcast microphone'] },
  }), null);
});

test('unrelated video misses', () => {
  assert.equal(mod.lookupVerifiedProductMapping({
    rawRegistry: fixture,
    allowTestFixtures: true,
    platform: 'youtube',
    contentRef: 'OTHER_VIDEO',
    description: shirt,
  }), null);
});

test('malformed records are ignored', () => {
  assert.equal(mod.parseVerifiedProductMappings('[{"platform":"youtube"}]').length, 0);
  assert.equal(mod.parseVerifiedProductMappings('not-json').length, 0);
});


test('YouTube raw IDs and canonical youtube: refs resolve to the same video', () => {
  const rawRegistry = JSON.stringify([{
    platform: 'youtube',
    content_ref: 'BR5fQYeqlJo',
    scope: 'entire_video',
    object_type: 'shirt',
    brand: 'Mizzen+Main',
    product_id: '1WS-1916',
    title: 'Leeward Dress Shirt',
    destination: 'https://www.mizzenandmain.com/',
    provenance: 'test_fixture',
  }]);
  const hit = mod.lookupVerifiedProductMapping({
    rawRegistry,
    allowTestFixtures: true,
    platform: 'youtube',
    contentRef: 'youtube:BR5fQYeqlJo',
    description: shirt,
  });
  assert.equal(hit?.product_id, '1WS-1916');
});


test('admin verified time-window mapping is deterministic only inside its verified window', () => {
  const mapping = {
    platform: 'youtube',
    content_ref: 'youtube:ADMIN_VIDEO',
    scope: 'time_window',
    timestamp_start_ms: 95000,
    timestamp_end_ms: 105000,
    object_type: 'button-down shirt',
    brand: 'Nike',
    product_id: 'ADMIN-SKU-1',
    title: 'Admin Verified Shirt',
    destination: 'https://www.nike.com/',
    provenance: 'admin_verified',
  };
  const hit = mod.lookupVerifiedProductMapping({
    mappings: [mapping],
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'ADMIN_VIDEO',
    timestampMs: 100000,
    description: shirt,
  });
  assert.equal(hit?.product_id, 'ADMIN-SKU-1');
  assert.equal(mod.verifiedMappingProduct(hit).result_class, 'EXACT');

  const miss = mod.lookupVerifiedProductMapping({
    mappings: [mapping],
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'ADMIN_VIDEO',
    timestampMs: 120000,
    description: shirt,
  });
  assert.equal(miss, null);
});


test('promoted Nike time-window mapping cannot override explicit New Balance evidence', () => {
  const mapping = {
    platform: 'youtube',
    content_ref: 'youtube:SHOE_VIDEO',
    scope: 'time_window',
    timestamp_start_ms: 407000,
    timestamp_end_ms: 417000,
    object_type: 'sneaker',
    brand: 'Nike',
    product_id: 'AIR-FORCE-1',
    title: 'Nike Air Force 1',
    destination: 'https://www.nike.com/',
    provenance: 'admin_verified',
  };
  const newBalance = {
    ...shirt,
    category: 'shoes',
    subcategory: 'sneaker',
    brand_candidate: 'New Balance',
    model_candidate: null,
    color: 'white',
    style_attributes: ['low top'],
    visible_text: ['New Balance'],
    logos_markings: ['New Balance logo'],
    distinctive_features: ['running sneaker'],
    shape_silhouette: ['low-top sneaker'],
    search_terms: ['New Balance white sneaker'],
    confidence: 0.95,
    identity_confidence: 0.8,
  };

  const hit = mod.lookupVerifiedProductMapping({
    mappings: [mapping],
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'SHOE_VIDEO',
    timestampMs: 412000,
    description: newBalance,
  });

  assert.equal(hit, null);
});

test('promoted time-window mapping still resolves when current brand evidence agrees', () => {
  const mapping = {
    platform: 'youtube',
    content_ref: 'youtube:SHOE_VIDEO',
    scope: 'time_window',
    timestamp_start_ms: 407000,
    timestamp_end_ms: 417000,
    object_type: 'sneaker',
    brand: 'Nike',
    product_id: 'AIR-FORCE-1',
    title: 'Nike Air Force 1',
    destination: 'https://www.nike.com/',
    provenance: 'admin_verified',
  };
  const nike = {
    ...shirt,
    category: 'shoes',
    subcategory: 'sneaker',
    brand_candidate: 'Nike',
    model_candidate: 'Air Force 1',
    color: 'white',
    style_attributes: ['low top'],
    visible_text: ['Nike'],
    logos_markings: ['Nike Swoosh'],
    distinctive_features: ['basketball sneaker'],
    shape_silhouette: ['low-top sneaker'],
    search_terms: ['Nike Air Force 1 white sneaker'],
    confidence: 0.95,
    identity_confidence: 0.9,
  };

  const hit = mod.lookupVerifiedProductMapping({
    mappings: [mapping],
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'SHOE_VIDEO',
    timestampMs: 412000,
    description: nike,
  });

  assert.equal(hit?.product_id, 'AIR-FORCE-1');
});


test('verified mapping preserves merchant thumbnail and provider for fallback display', () => {
  const mapping = {
    platform: 'youtube',
    content_ref: 'youtube:MERCHANT_VIDEO',
    scope: 'time_window',
    timestamp_start_ms: 1000,
    timestamp_end_ms: 9000,
    object_type: 't-shirt',
    brand: '',
    product_id: 'shirt-1',
    title: 'Building is my Love Language Black Oversized Tee',
    destination: 'https://www.ebay.com/itm/example',
    image_reference: 'https://i.ebayimg.com/example.jpg',
    provider: 'ebay',
    provenance: 'admin_verified',
  };
  const product = mod.verifiedMappingProduct(mapping);
  assert.equal(product.image_reference, 'https://i.ebayimg.com/example.jpg');
  assert.equal(product.provider, 'ebay');
  assert.equal(product.result_class, 'EXACT');
});


test('equivalent durable and seed mappings merge richer metadata without changing product identity', () => {
  const hit = mod.lookupVerifiedProductMapping({
    mappings: [
      {
        platform: 'youtube',
        content_ref: 'youtube:BR5fQYeqlJo',
        scope: 'entire_video',
        object_type: 'shirt',
        brand: 'Mizzen+Main',
        product_id: '1WS-1916',
        title: 'Leeward Dress Shirt',
        destination: 'https://www.mizzenandmain.com/products/steel-blue-tonal-texture-leeward-dress-shirt',
        image_reference: null,
        provider: null,
        provenance: 'admin_verified',
      },
      {
        platform: 'youtube',
        content_ref: 'BR5fQYeqlJo',
        scope: 'entire_video',
        object_type: 'shirt',
        brand: 'Mizzen+Main',
        product_id: '1WS-1916',
        title: 'Leeward Dress Shirt',
        destination: 'https://www.mizzenandmain.com/products/steel-blue-tonal-texture-leeward-dress-shirt',
        image_reference: 'https://cdn.shopify.com/1WS-1916.jpg',
        provider: 'mizzenandmain',
        provenance: 'admin_verified',
      },
    ],
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'BR5fQYeqlJo',
    description: shirt,
  });

  assert.equal(hit?.product_id, '1WS-1916');
  assert.equal(hit?.content_ref, 'youtube:BR5fQYeqlJo');
  assert.equal(hit?.image_reference, 'https://cdn.shopify.com/1WS-1916.jpg');
  assert.equal(hit?.provider, 'mizzenandmain');
});


test('contextual SKU text selects the correct product among multiple verified products in one video', () => {
  const mappings = [
    {
      platform: 'youtube', content_ref: '1auV6jxLh_Q', scope: 'entire_video', object_type: 'bag',
      brand: 'Louis Vuitton', product_id: 'N48280', title: 'Louis Vuitton Pochette Métis',
      destination: 'https://example.com/N48280', provenance: 'admin_verified',
    },
    {
      platform: 'youtube', content_ref: '1auV6jxLh_Q', scope: 'entire_video', object_type: 'bag',
      brand: 'Louis Vuitton', product_id: 'N40952', title: 'Louis Vuitton Neverfull Inside Out MM',
      destination: 'https://example.com/N40952', provenance: 'admin_verified',
    },
  ];
  const description = {
    ...shirt,
    category: 'Bags',
    subcategory: 'Tote Bag',
    brand_candidate: 'Louis Vuitton',
    model_candidate: 'Neverfull',
    contextual_text: ['Neverfull I-O MM', 'N40952'],
    evidence_confidence: { contextual_text: 0.95 },
    search_terms: ['Louis Vuitton Neverfull N40952'],
  };

  const hit = mod.lookupVerifiedProductMapping({
    mappings,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: '1auV6jxLh_Q',
    description,
  });

  assert.equal(hit?.product_id, 'N40952');
});


test('multi-product partner catalog does not force a family-level Speedy guess to Exact', () => {
  const mappings = [
    {
      platform: 'youtube', content_ref: '1auV6jxLh_Q', scope: 'entire_video', object_type: 'bag',
      brand: 'Louis Vuitton', product_id: 'M3A350', title: 'Louis Vuitton Speedy Soft 25',
      destination: 'https://example.com/M3A350', provenance: 'admin_verified',
    },
    {
      platform: 'youtube', content_ref: '1auV6jxLh_Q', scope: 'entire_video', object_type: 'bag',
      brand: 'Louis Vuitton', product_id: 'N40952', title: 'Louis Vuitton Neverfull Inside Out MM',
      destination: 'https://example.com/N40952', provenance: 'admin_verified',
    },
  ];
  const description = {
    ...shirt,
    category: 'Bags',
    subcategory: 'Handbag',
    brand_candidate: 'Louis Vuitton',
    model_candidate: 'Speedy',
    color: 'Wine',
    search_terms: ['Louis Vuitton Speedy wine bag'],
  };

  const hit = mod.lookupVerifiedProductMapping({
    mappings,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: '1auV6jxLh_Q',
    description,
  });

  assert.equal(hit, null);
});

test('multi-product partner catalog resolves when the exact SKU is explicitly grounded', () => {
  const mappings = [
    {
      platform: 'youtube', content_ref: '1auV6jxLh_Q', scope: 'entire_video', object_type: 'bag',
      brand: 'Louis Vuitton', product_id: 'M3A350', title: 'Louis Vuitton Speedy Soft 25',
      destination: 'https://example.com/M3A350', provenance: 'admin_verified',
    },
    {
      platform: 'youtube', content_ref: '1auV6jxLh_Q', scope: 'entire_video', object_type: 'bag',
      brand: 'Louis Vuitton', product_id: 'N40952', title: 'Louis Vuitton Neverfull Inside Out MM',
      destination: 'https://example.com/N40952', provenance: 'admin_verified',
    },
  ];
  const description = {
    ...shirt,
    category: 'Bags',
    subcategory: 'Tote Bag',
    brand_candidate: 'Louis Vuitton',
    model_candidate: 'Neverfull',
    contextual_text: ['Neverfull I-O MM', 'N40952'],
    evidence_confidence: { contextual_text: 0.95 },
    search_terms: ['Louis Vuitton Neverfull N40952'],
  };

  const hit = mod.lookupVerifiedProductMapping({
    mappings,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: '1auV6jxLh_Q',
    description,
  });

  assert.equal(hit?.product_id, 'N40952');
});
