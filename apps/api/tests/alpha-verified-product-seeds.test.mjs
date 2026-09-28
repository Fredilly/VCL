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
