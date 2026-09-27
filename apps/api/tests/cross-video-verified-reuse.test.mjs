import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mod = loadModule(resolve(here, '../src/cross-video-verified-reuse.ts'));

const identity = {
  canonical_key: 'product:v1:building-love',
  title: 'Building Is My Love Language Black Oversized Tee',
  brand: null,
  model: null,
  object_type: 't-shirt',
  visible_text: ['BUILDING IS MY LOVE LANGUAGE'],
  color: 'black',
  material: 'cotton',
  style_attributes: ['oversized'],
  logos_markings: ['BUILDING IS MY LOVE LANGUAGE'],
  distinctive_features: ['tonal embossed chest text'],
  shape_silhouette: ['short sleeve oversized tee'],
  normalized_fingerprint: 'fixture',
  relationship: 'EXACT',
  provenance: 'admin_verified',
  verified_at: '2026-09-27T00:00:00.000Z',
  merchant_refs: [{
    source: 'ebay',
    item_id: 'v1|307197731843|607037825827',
    destination: 'https://www.ebay.com/itm/307197731843?var=607037825827',
    image_reference: 'https://i.ebayimg.com/item.jpg',
  }],
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
  logos_markings: ['BUILDING IS MY LOVE LANGUAGE'],
  distinctive_features: ['tonal embossed chest text'],
  hardware_details: [],
  shape_silhouette: ['short sleeve oversized tee'],
  search_terms: ['building is my love language shirt'],
  confidence: 0.9,
  identity_confidence: 0.1,
};

const strongVisual = {
  source: {
    subtype: { value: 't-shirt', confidence: 0.98, basis: 'image' },
    color: { value: 'black', confidence: 0.97, basis: 'image' },
    sleeve: { value: 'short', confidence: 0.96, basis: 'image' },
  },
  candidate: {
    subtype: { value: 't-shirt', confidence: 0.99, basis: 'image' },
    color: { value: 'black', confidence: 0.97, basis: 'image' },
    sleeve: { value: 'short', confidence: 0.95, basis: 'image' },
  },
  similarity: 0.96,
  confidence: 0.95,
  matching_details: ['same tonal chest lettering layout and oversized silhouette'],
};

test('distinctive identity in another video is only a candidate before visual confirmation', () => {
  const candidates = mod.crossVideoCanonicalCandidates({ description, identities: [identity] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].canonical_key, identity.canonical_key);
  assert.equal(candidates[0].reason, 'distinctive_text_candidate');
});

test('cross-video Exact requires stricter visual agreement than same-video reuse', () => {
  const candidates = mod.crossVideoCanonicalCandidates({ description, identities: [identity] });
  const weak = mod.confirmCrossVideoVisual(candidates, new Map([[
    identity.canonical_key,
    { ...strongVisual, similarity: 0.92, confidence: 0.95 },
  ]]));
  assert.equal(weak.identity, null);

  const strong = mod.confirmCrossVideoVisual(candidates, new Map([[identity.canonical_key, strongVisual]]));
  assert.equal(strong.identity?.canonical_key, identity.canonical_key);
  assert.equal(strong.reason, 'visual_confirmed');
});

test('explicit color contradiction blocks cross-video reuse before visual verification', () => {
  const candidates = mod.crossVideoCanonicalCandidates({
    description: { ...description, color: 'white' },
    identities: [identity],
  });
  assert.equal(candidates.length, 0);
});

test('visually similar but different product does not inherit Exact', () => {
  const candidates = mod.crossVideoCanonicalCandidates({ description, identities: [identity] });
  const result = mod.confirmCrossVideoVisual(candidates, new Map([[
    identity.canonical_key,
    {
      ...strongVisual,
      candidate: {
        ...strongVisual.candidate,
        color: { value: 'white', confidence: 0.98, basis: 'image' },
      },
      similarity: 0.98,
      confidence: 0.98,
    },
  ]]));
  assert.equal(result.identity, null);
});

test('multiple seller canonicals for the same visually confirmed product collapse to one product', () => {
  const other = {
    ...identity,
    canonical_key: 'product:v1:other-seller',
    title: 'Funny Quote Building is My Love Language Mark Saying Tee T-Shirt',
    visible_text: ['BUILDING IS MY LOVE'],
    logos_markings: [],
    merchant_refs: [{
      source: 'ebay',
      item_id: 'v1|999|111',
      destination: 'https://www.ebay.com/itm/999?var=111',
      image_reference: 'https://i.ebayimg.com/other.jpg',
    }],
  };
  const candidates = mod.crossVideoCanonicalCandidates({ description, identities: [identity, other] });
  const result = mod.confirmCrossVideoVisual(candidates, new Map([
    [identity.canonical_key, strongVisual],
    [other.canonical_key, { ...strongVisual, similarity: 0.95 }],
  ]));
  assert.ok(result.identity);
  assert.equal(result.reason, 'visual_confirmed');
  assert.deepEqual(
    new Set(result.equivalent_canonical_keys),
    new Set([identity.canonical_key, other.canonical_key]),
  );
  assert.equal(result.identity.merchant_refs.length, 2);
});

test('ambiguous cross-video matches with different identity evidence still fail closed', () => {
  const other = {
    ...identity,
    canonical_key: 'product:v1:other',
    visible_text: ['BUILDING SOMETHING ELSE ENTIRELY'],
    logos_markings: ['BUILDING SOMETHING ELSE ENTIRELY'],
    title: 'Building Something Else Entirely Black Tee',
  };
  const candidates = mod.crossVideoCanonicalCandidates({
    description: {
      ...description,
      visible_text: [],
      logos_markings: [],
      search_terms: ['black graphic shirt'],
    },
    identities: [identity, other],
  });
  const forcedCandidates = [identity, other].map((candidateIdentity) => ({
    identity: candidateIdentity,
    canonical_key: candidateIdentity.canonical_key,
    confidence: 0.9,
    reason: 'distinctive_text_candidate',
  }));
  const result = mod.confirmCrossVideoVisual(forcedCandidates, new Map([
    [identity.canonical_key, strongVisual],
    [other.canonical_key, { ...strongVisual, similarity: 0.95 }],
  ]));
  assert.equal(result.identity, null);
  assert.equal(result.reason, 'ambiguous');
});

test('exact model match is still only a candidate until cross-video visual confirmation', () => {
  const modeled = { ...identity, model: 'SKU-123' };
  const candidates = mod.crossVideoCanonicalCandidates({
    description: { ...description, model_candidate: 'SKU-123', visible_text: [] },
    identities: [modeled],
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].reason, 'model_candidate');
  assert.equal(mod.confirmCrossVideoVisual(candidates, new Map()).identity, null);
});


test('partial stored OCR can still nominate a canonical product from its verified title', () => {
  const partial = {
    ...identity,
    visible_text: ['BUILDING IS MY LOVE'],
    logos_markings: [],
  };
  const candidates = mod.crossVideoCanonicalCandidates({
    description,
    identities: [partial],
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].canonical_key, identity.canonical_key);
  assert.equal(candidates[0].reason, 'distinctive_text_candidate');
});
