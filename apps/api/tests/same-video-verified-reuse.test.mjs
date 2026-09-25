import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mod = loadModule(resolve(here, '../src/same-video-verified-reuse.ts'));

const mapping = {
  platform: 'youtube',
  content_ref: 'youtube:video-1',
  scope: 'time_window',
  timestamp_start_ms: 1000,
  timestamp_end_ms: 9000,
  object_type: 't-shirt',
  brand: '',
  product_id: 'merchant-item-1',
  title: 'Building is my Love Language Black Oversized Tee',
  destination: 'https://www.ebay.com/itm/merchant-item-1',
  provider: 'ebay',
  canonical_key: 'product:v1:shirt',
  provenance: 'admin_verified',
};

const identity = {
  canonical_key: 'product:v1:shirt',
  title: mapping.title,
  brand: null,
  model: null,
  object_type: 't-shirt',
  visible_text: ['BUILDING IS MY LOVE LANGUAGE'],
  normalized_fingerprint: 'test',
  provenance: 'admin_verified',
  verified_at: '2026-09-25T00:00:00.000Z',
  merchant_refs: [],
};

const description = {
  category: 'apparel',
  subcategory: 't-shirt',
  brand_candidate: null,
  model_candidate: null,
  color: 'black',
  material: 'cotton',
  style_attributes: ['oversized'],
  visible_text: ['BUILDING', 'IS MY LOVE', 'LANGUAGE'],
  logos_markings: [],
  distinctive_features: ['embossed text graphic'],
  hardware_details: [],
  shape_silhouette: ['short sleeve'],
  search_terms: ['building is my love language shirt'],
  confidence: 0.9,
  identity_confidence: 0.1,
};

test('same shirt later in same video reuses verified identity from strong visible text', () => {
  const result = mod.chooseSameVideoVerifiedReuse({ description, candidates: [{ mapping, identity }] });
  assert.equal(result.mapping?.product_id, 'merchant-item-1');
  assert.equal(result.canonical_key, 'product:v1:shirt');
  assert.ok(result.confidence >= 0.95);
  assert.match(result.reason, /visible_text/);
});

test('generic same-category item does not inherit exact identity', () => {
  const result = mod.chooseSameVideoVerifiedReuse({
    description: { ...description, visible_text: [], search_terms: ['black oversized t-shirt'] },
    candidates: [{ mapping, identity }],
  });
  assert.equal(result.mapping, null);
  assert.equal(result.reason, 'weak_evidence');
});

test('explicit brand contradiction blocks reuse', () => {
  const brandedIdentity = { ...identity, brand: 'Nike' };
  const result = mod.chooseSameVideoVerifiedReuse({
    description: { ...description, brand_candidate: 'Adidas' },
    candidates: [{ mapping, identity: brandedIdentity }],
  });
  assert.equal(result.mapping, null);
  assert.equal(result.reason, 'brand_conflict');
});

test('explicit model contradiction blocks reuse', () => {
  const modeledIdentity = { ...identity, model: 'MODEL-A' };
  const result = mod.chooseSameVideoVerifiedReuse({
    description: { ...description, model_candidate: 'MODEL-B' },
    candidates: [{ mapping, identity: modeledIdentity }],
  });
  assert.equal(result.mapping, null);
  assert.equal(result.reason, 'model_conflict');
});

test('two different canonical products matching the same evidence fail closed as ambiguous', () => {
  const secondMapping = { ...mapping, product_id: 'merchant-item-2', canonical_key: 'product:v1:shirt-2' };
  const secondIdentity = { ...identity, canonical_key: 'product:v1:shirt-2' };
  const result = mod.chooseSameVideoVerifiedReuse({
    description,
    candidates: [{ mapping, identity }, { mapping: secondMapping, identity: secondIdentity }],
  });
  assert.equal(result.mapping, null);
  assert.equal(result.reason, 'ambiguous');
});

test('exact stored and observed model is strong enough without visible text', () => {
  const modeledIdentity = { ...identity, model: 'SKU-123' };
  const result = mod.chooseSameVideoVerifiedReuse({
    description: { ...description, visible_text: [], model_candidate: 'SKU-123' },
    candidates: [{ mapping, identity: modeledIdentity }],
  });
  assert.equal(result.mapping?.product_id, 'merchant-item-1');
  assert.equal(result.reason, 'model_exact');
  assert.equal(result.confidence, 1);
});
