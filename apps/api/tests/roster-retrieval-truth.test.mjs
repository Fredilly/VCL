import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const fallback = loadModule(new URL('../src/roster-fallback.ts', import.meta.url).pathname);
const commerce = loadModule(new URL('../src/commerce.ts', import.meta.url).pathname);
const reuse = loadModule(new URL('../src/same-video-verified-reuse.ts', import.meta.url).pathname);

const description = (overrides = {}) => ({
  category: 'Bags',
  subcategory: 'Vanity Case',
  brand_candidate: 'Acme',
  model_candidate: 'Cannes',
  color: 'White',
  material: 'Leather',
  style_attributes: ['Monogram', 'Structured'],
  visible_text: [],
  contextual_text: [],
  logos_markings: ['Acme monogram pattern'],
  distinctive_features: ['light blue monogram', 'front padlock'],
  hardware_details: ['Gold-tone padlock'],
  shape_silhouette: ['structured vanity case'],
  search_terms: ['Acme Cannes Vanity Case'],
  confidence: 0.9,
  identity_confidence: 0.9,
  evidence_confidence: { model_candidate: 0.8, contextual_text: 0, visible_text: 0 },
  ...overrides,
});

const rosterCandidate = ({ key, title, family, model = null, color = null, features = [], shape = [] }) => ({
  mapping: {
    platform: 'youtube',
    content_ref: 'test-video',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Acme',
    product_id: key,
    variant_id: key,
    family,
    title,
    destination: `https://merchant.test/${key}`,
    provenance: 'admin_verified',
    canonical_key: key,
    track_id: key,
  },
  identity: {
    canonical_key: key,
    title,
    brand: 'Acme',
    model,
    variant_id: key,
    family,
    object_type: 'bag',
    visible_text: [],
    color,
    material: 'leather',
    style_attributes: [],
    logos_markings: ['Acme monogram'],
    distinctive_features: features,
    shape_silhouette: shape,
    normalized_fingerprint: key,
    relationship: 'EXACT',
    provenance: 'admin_verified',
    verified_at: '2026-10-07T00:00:00Z',
    merchant_refs: [],
  },
});

test('roster miss separates retrieval hypothesis from identity proof', () => {
  const source = description();
  const safe = fallback.rosterFallbackDescription(source);
  const retrieval = fallback.rosterFallbackRetrievalDescription(source);

  assert.equal(safe.model_candidate, null, 'ungrounded model guess must not verify identity');
  assert.equal(retrieval.model_candidate, 'Cannes', 'family guess may still nominate a bounded search');
  assert.equal(retrieval.identity_confidence, 0, 'retrieval hypothesis must not regain identity authority');

  const queries = commerce.buildProductQueryVariants(retrieval);
  assert.ok(queries.some((row) => /Cannes/i.test(row.query)));
  assert.ok(queries.some((row) => /Vanity Case/i.test(row.query)));
  assert.ok(queries.every((row) => !/^bag White$/i.test(row.query)));
});

test('chaotic roster ranking is evidence-driven and independent of input order', () => {
  const source = description({
    subcategory: 'Handbag',
    model_candidate: 'Carry 40',
    color: 'Red',
    distinctive_features: ['red monogram', 'tan luggage tag', 'double top handles'],
    shape_silhouette: ['duffle handbag'],
    search_terms: ['Acme Carry 40 red monogram handbag'],
  });
  const correct = rosterCandidate({
    key: 'sku-red-carry-40',
    title: 'Acme Carry 40 Red Monogram Handbag',
    family: 'Carry 40',
    color: 'red',
    features: ['red monogram', 'tan luggage tag', 'double top handles'],
    shape: ['duffle handbag'],
  });
  const sibling = rosterCandidate({
    key: 'sku-brown-carry-25',
    title: 'Acme Carry 25 Brown Monogram Handbag',
    family: 'Carry 25',
    color: 'brown',
    features: ['brown monogram', 'double top handles'],
    shape: ['duffle handbag'],
  });
  const other = rosterCandidate({
    key: 'sku-trunk',
    title: 'Acme Petite Trunk Brown Bag',
    family: 'Petite Trunk',
    color: 'brown',
    features: ['corner protectors', 'box clasp'],
    shape: ['flat trunk bag'],
  });

  const first = reuse.rankSameVideoRosterCandidates({ description: source, candidates: [other, sibling, correct] });
  const second = reuse.rankSameVideoRosterCandidates({ description: source, candidates: [correct, other, sibling] });
  assert.equal(first[0].identity.canonical_key, correct.identity.canonical_key);
  assert.deepEqual(first.map((row) => row.identity.canonical_key), second.map((row) => row.identity.canonical_key));
});

test('specific visual subtype survives broad commerce query construction', () => {
  const retrieval = fallback.rosterFallbackRetrievalDescription(description({ model_candidate: null }));
  const queries = commerce.buildProductQueryVariants(retrieval);
  assert.ok(queries.some((row) => /Vanity Case/i.test(row.query)));
  assert.ok(queries.every((row) => !/^bag White$/i.test(row.query)));
});
