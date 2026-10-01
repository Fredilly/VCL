import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mappingMod = loadModule(resolve(here, '../src/verified-product-mapping.ts'));
const seedMod = loadModule(resolve(here, '../src/alpha-verified-product-seeds.ts'));

const ricShirt = {
  category: 'apparel',
  subcategory: 'shirt',
  brand_candidate: null,
  model_candidate: null,
  color: 'light blue',
  material: '',
  style_attributes: ['gingham check pattern', 'long sleeve'],
  visible_text: [],
  logos_markings: [],
  distinctive_features: [],
  hardware_details: [],
  shape_silhouette: [],
  search_terms: ['light blue gingham shirt'],
  confidence: 0.9,
  identity_confidence: 0.1,
};


const stephenAJordanPolo = {
  category: 'apparel',
  subcategory: 'polo',
  brand_candidate: 'Jordan',
  model_candidate: null,
  color: 'blue',
  material: '',
  style_attributes: ['polo shirt', 'short sleeve'],
  visible_text: [],
  logos_markings: ['Jumpman'],
  distinctive_features: [],
  hardware_details: [],
  shape_silhouette: ['polo'],
  search_terms: ['Jordan blue polo'],
  confidence: 0.95,
  identity_confidence: 0.3,
};

const kithYankeesCap = {
  category: 'apparel',
  subcategory: 'baseball cap',
  brand_candidate: 'Kith',
  model_candidate: null,
  color: 'black',
  material: 'cotton',
  style_attributes: ['low profile', 'fitted'],
  visible_text: ['NY'],
  logos_markings: ['New York Yankees'],
  distinctive_features: ['sun faded finish'],
  hardware_details: [],
  shape_silhouette: ['baseball cap'],
  search_terms: ['black Yankees cap'],
  confidence: 0.95,
  identity_confidence: 0.3,
};

test('Ric alpha creator demo resolves the configured next-best verified product for the whole video', () => {
  const hit = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'BR5fQYeqlJo',
    timestampMs: 123000,
    description: ricShirt,
  });

  assert.equal(hit?.product_id, '1WS-1916');
  assert.equal(hit?.scope, 'entire_video');
  assert.equal(hit?.provenance, 'admin_verified');
  assert.equal(hit?.destination, 'https://www.mizzenandmain.com/products/steel-blue-tonal-texture-leeward-dress-shirt');
  assert.ok(hit?.image_reference?.includes('1WS-1916_Folded.jpg'));
});

test('Ric seed does not fire for a non-shirt click in the same video', () => {
  const miss = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'BR5fQYeqlJo',
    timestampMs: 123000,
    description: { ...ricShirt, category: 'electronics', subcategory: 'microphone', search_terms: ['podcast microphone'] },
  });

  assert.equal(miss, null);
});

test('Ronnie Fieg video resolves the verified Kith Yankees cap across the video', () => {
  const hit = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'PsL2hXoDVCw',
    timestampMs: 600000,
    description: kithYankeesCap,
  });

  assert.equal(hit?.product_id, 'KHMA050113-001');
  assert.equal(hit?.scope, 'entire_video');
  assert.equal(hit?.provenance, 'admin_verified');
  assert.equal(hit?.brand, "Kith & '47");
  assert.ok(hit?.destination.endsWith('/khma050113-001'));
  assert.ok(hit?.image_reference?.includes('KHMA050113-001-Detail.jpg'));
});

test('Ronnie Fieg cap seed does not fire for jacket, jeans, or sunglasses clicks', () => {
  for (const subcategory of ['jacket', 'jeans', 'sunglasses']) {
    const miss = mappingMod.lookupVerifiedProductMapping({
      mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
      allowTestFixtures: false,
      platform: 'youtube',
      contentRef: 'PsL2hXoDVCw',
      timestampMs: 600000,
      description: {
        ...kithYankeesCap,
        subcategory,
        style_attributes: [],
        shape_silhouette: [subcategory],
        search_terms: [subcategory],
      },
    });
    assert.equal(miss, null, `seed must not leak into ${subcategory}`);
  }
});


test('Stephen A. Smith video resolves the verified Jordan polo across the video', () => {
  const hit = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'wDev1WhWvQs',
    timestampMs: 120000,
    description: stephenAJordanPolo,
  });

  assert.equal(hit?.product_id, 'II5381-417');
  assert.equal(hit?.scope, 'entire_video');
  assert.equal(hit?.provenance, 'admin_verified');
  assert.equal(hit?.brand, 'Jordan');
  assert.equal(hit?.destination, 'https://www.nike.com/t/jordan-mens-polo-mbLOwHgG/II5381-417');
});

test('Stephen A. Jordan polo seed does not fire for non-shirt clicks in the same video', () => {
  for (const subcategory of ['watch', 'glasses', 'microphone']) {
    const miss = mappingMod.lookupVerifiedProductMapping({
      mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
      allowTestFixtures: false,
      platform: 'youtube',
      contentRef: 'wDev1WhWvQs',
      timestampMs: 120000,
      description: {
        ...stephenAJordanPolo,
        category: subcategory === 'microphone' ? 'electronics' : 'accessories',
        subcategory,
        style_attributes: [],
        shape_silhouette: [subcategory],
        search_terms: [subcategory],
      },
    });
    assert.equal(miss, null, `seed must not leak into ${subcategory}`);
  }
});
