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
  assert.deepEqual(mod.parseVerifiedProductMappings('[{"platform":"youtube"}]'), []);
  assert.deepEqual(mod.parseVerifiedProductMappings('not-json'), []);
});
