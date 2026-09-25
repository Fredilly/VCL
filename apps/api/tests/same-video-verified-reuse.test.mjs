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
  color: 'black',
  material: 'cotton',
  style_attributes: ['oversized'],
  logos_markings: ['building is my love language text'],
  distinctive_features: ['embossed tonal text graphic'],
  shape_silhouette: ['short sleeve oversized tee'],
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
  logos_markings: ['building is my love language'],
  distinctive_features: ['embossed tonal text graphic'],
  hardware_details: [],
  shape_silhouette: ['short sleeve oversized tee'],
  search_terms: ['building is my love language shirt'],
  confidence: 0.9,
  identity_confidence: 0.1,
};

const visualMatch = {
  source: {
    subtype: { value: 't-shirt', confidence: 0.98, basis: 'image' },
    color: { value: 'black', confidence: 0.96, basis: 'image' },
    sleeve: { value: 'short', confidence: 0.94, basis: 'image' },
  },
  candidate: {
    subtype: { value: 't-shirt', confidence: 0.99, basis: 'image' },
    color: { value: 'black', confidence: 0.96, basis: 'image' },
    sleeve: { value: 'short', confidence: 0.93, basis: 'image' },
  },
  similarity: 0.96,
  confidence: 0.94,
  matching_details: ['same tonal chest lettering layout', 'same oversized short sleeve silhouette'],
};

test('same shirt later in same video becomes only a fingerprint candidate before visual confirmation', () => {
  const result = mod.chooseSameVideoVerifiedReuse({ description, candidates: [{ mapping, identity }] });
  assert.equal(result.mapping?.product_id, 'merchant-item-1');
  assert.equal(result.canonical_key, 'product:v1:shirt');
  assert.equal(result.reason, 'fingerprint_candidate');
  assert.equal(result.requires_visual, true);
});

test('high visual agreement confirms the canonical identity as reusable', () => {
  const candidate = mod.chooseSameVideoVerifiedReuse({ description, candidates: [{ mapping, identity }] });
  const result = mod.confirmSameVideoVisual(candidate, visualMatch);
  assert.equal(result.mapping?.product_id, 'merchant-item-1');
  assert.equal(result.reason, 'visual_confirmed');
  assert.ok(result.confidence >= 0.96);
  assert.equal(result.requires_visual, false);
});

test('same slogan with materially different pixels stays unverified', () => {
  const candidate = mod.chooseSameVideoVerifiedReuse({ description, candidates: [{ mapping, identity }] });
  const result = mod.confirmSameVideoVisual(candidate, {
    ...visualMatch,
    similarity: 0.74,
    confidence: 0.94,
    matching_details: ['same black t-shirt category'],
  });
  assert.equal(result.mapping, null);
  assert.equal(result.reason, 'visual_rejected');
});

test('visual attribute contradiction fails closed even at high similarity', () => {
  const candidate = mod.chooseSameVideoVerifiedReuse({ description, candidates: [{ mapping, identity }] });
  const result = mod.confirmSameVideoVisual(candidate, {
    ...visualMatch,
    candidate: {
      ...visualMatch.candidate,
      color: { value: 'white', confidence: 0.97, basis: 'image' },
    },
    similarity: 0.97,
  });
  assert.equal(result.mapping, null);
  assert.equal(result.reason, 'visual_rejected');
});

test('legacy identity with slogan but no rich fingerprint remains eligible for visual confirmation', () => {
  const legacy = {
    ...identity,
    color: undefined,
    material: undefined,
    style_attributes: undefined,
    logos_markings: undefined,
    distinctive_features: undefined,
    shape_silhouette: undefined,
  };
  const result = mod.chooseSameVideoVerifiedReuse({ description, candidates: [{ mapping, identity: legacy }] });
  assert.equal(result.mapping?.product_id, 'merchant-item-1');
  assert.equal(result.requires_visual, true);
});



test('weak OCR can still reach visual confirmation from strong structural agreement', () => {
  const result = mod.chooseSameVideoVerifiedReuse({
    description: {
      ...description,
      visible_text: [],
      logos_markings: [],
      search_terms: ['black t-shirt'],
    },
    candidates: [{ mapping, identity }],
  });
  assert.equal(result.mapping?.product_id, 'merchant-item-1');
  assert.equal(result.reason, 'fingerprint_candidate');
  assert.equal(result.requires_visual, true);

  const confirmed = mod.confirmSameVideoVisual(result, visualMatch);
  assert.equal(confirmed.mapping?.product_id, 'merchant-item-1');
  assert.equal(confirmed.reason, 'visual_confirmed');
});

test('generic same-category item does not become a reuse candidate', () => {
  const result = mod.chooseSameVideoVerifiedReuse({
    description: {
      ...description,
      visible_text: [],
      logos_markings: [],
      distinctive_features: ['graphic front'],
      shape_silhouette: ['short sleeve'],
      style_attributes: [],
      search_terms: ['black oversized t-shirt'],
    },
    candidates: [{ mapping, identity }],
  });
  assert.equal(result.mapping, null);
  assert.equal(result.reason, 'weak_evidence');
});

test('explicit brand contradiction blocks reuse before visual verification', () => {
  const brandedIdentity = { ...identity, brand: 'Nike' };
  const result = mod.chooseSameVideoVerifiedReuse({
    description: { ...description, brand_candidate: 'Adidas' },
    candidates: [{ mapping, identity: brandedIdentity }],
  });
  assert.equal(result.mapping, null);
  assert.equal(result.reason, 'brand_conflict');
});

test('explicit model contradiction blocks reuse before visual verification', () => {
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

test('exact stored and observed model is strong enough without extra visual call', () => {
  const modeledIdentity = { ...identity, model: 'SKU-123' };
  const result = mod.chooseSameVideoVerifiedReuse({
    description: { ...description, visible_text: [], model_candidate: 'SKU-123' },
    candidates: [{ mapping, identity: modeledIdentity }],
  });
  assert.equal(result.mapping?.product_id, 'merchant-item-1');
  assert.equal(result.reason, 'model_exact');
  assert.equal(result.confidence, 1);
  assert.equal(result.requires_visual, false);
});


test('same-video canonical candidate reaches visual selection even when OCR and structure are weak', () => {
  const weak = {
    ...description,
    visible_text: [],
    logos_markings: [],
    distinctive_features: [],
    shape_silhouette: [],
    style_attributes: [],
    search_terms: [],
  };
  const eligible = mod.eligibleSameVideoCanonicalCandidates({
    description: weak,
    candidates: [{ mapping, identity }],
  });
  assert.equal(eligible.length, 1);

  const winner = mod.selectSameVideoVisualWinner({
    candidates: eligible,
    comparisons: new Map([[identity.canonical_key, visualMatch]]),
  });
  assert.equal(winner.mapping?.product_id, 'merchant-item-1');
  assert.equal(winner.reason, 'visual_confirmed');
});

test('multiple visually confirmed canonical products fail closed as ambiguous', () => {
  const secondMapping = { ...mapping, product_id: 'merchant-item-2', canonical_key: 'product:v1:shirt-2' };
  const secondIdentity = { ...identity, canonical_key: 'product:v1:shirt-2' };
  const eligible = mod.eligibleSameVideoCanonicalCandidates({
    description,
    candidates: [{ mapping, identity }, { mapping: secondMapping, identity: secondIdentity }],
  });
  const winner = mod.selectSameVideoVisualWinner({
    candidates: eligible,
    comparisons: new Map([
      [identity.canonical_key, visualMatch],
      [secondIdentity.canonical_key, { ...visualMatch, similarity: 0.95 }],
    ]),
  });
  assert.equal(winner.mapping, null);
  assert.equal(winner.reason, 'ambiguous');
});

test('visually weak canonical candidate stays non-exact', () => {
  const eligible = mod.eligibleSameVideoCanonicalCandidates({
    description,
    candidates: [{ mapping, identity }],
  });
  const winner = mod.selectSameVideoVisualWinner({
    candidates: eligible,
    comparisons: new Map([[identity.canonical_key, { ...visualMatch, similarity: 0.8 }]]),
  });
  assert.equal(winner.mapping, null);
  assert.equal(winner.reason, 'visual_rejected');
});
