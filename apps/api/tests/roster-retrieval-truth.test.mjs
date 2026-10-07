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

const rosterCandidate = ({ key, title, family, model = null, color = null, features = [], shape = [], track = true }) => ({
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
    ...(track ? { track_id: key } : {}),
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


const comparison = (similarity, details = ['matching construction and hardware']) => ({
  source: { subtype: { value: 'bag', confidence: 0.98, basis: 'image' } },
  candidate: { subtype: { value: 'bag', confidence: 0.98, basis: 'image' } },
  similarity,
  confidence: 0.98,
  matching_details: details,
});

test('wrong model or color guesses cannot delete the correct roster SKU before visual verification', () => {
  const source = description({
    subcategory: 'Shoulder Bag',
    model_candidate: 'Sibling Box',
    color: 'Brown',
    distinctive_features: ['box clasp'],
  });
  const staleSibling = rosterCandidate({
    key: 'sku-sibling-box',
    title: 'Acme Sibling Box Brown',
    family: 'Sibling Box',
    model: 'Sibling Box',
    color: 'brown',
    features: ['box clasp'],
    shape: ['flat box bag'],
    track: true,
  });
  const correct = rosterCandidate({
    key: 'sku-soft-trunk',
    title: 'Acme Soft Trunk Red',
    family: 'Soft Trunk',
    model: 'Soft Trunk',
    color: 'red',
    features: ['corner hardware', 'double strap'],
    shape: ['soft trunk shoulder bag'],
    track: false,
  });

  const eligible = reuse.eligibleSameVideoCanonicalCandidates({ description: source, candidates: [staleSibling, correct] });
  assert.deepEqual(new Set(eligible.map((row) => row.identity.canonical_key)), new Set(['sku-sibling-box', 'sku-soft-trunk']));

  const comparisons = new Map([
    ['sku-sibling-box', comparison(0.45, ['different silhouette and hardware'])],
    ['sku-soft-trunk', comparison(0.97, ['matching corner hardware and strap construction'])],
  ]);
  const decision = reuse.resolveSameVideoReuse({ description: source, candidates: [staleSibling, correct], comparisons });
  assert.equal(decision.canonical_key, 'sku-soft-trunk');
  assert.equal(decision.reason, 'visual_confirmed');
});

test('a previously promoted sibling does not become an exclusive answer set', () => {
  const source = description({ model_candidate: 'Wrong Family', color: 'Brown' });
  const promotedWrong = rosterCandidate({
    key: 'sku-promoted-wrong',
    title: 'Acme Wrong Family Brown',
    family: 'Wrong Family',
    model: 'Wrong Family',
    color: 'brown',
    track: true,
  });
  const unpromotedCorrect = rosterCandidate({
    key: 'sku-correct',
    title: 'Acme Correct Family White',
    family: 'Correct Family',
    model: 'Correct Family',
    color: 'white',
    track: false,
  });

  const comparisons = new Map([
    ['sku-promoted-wrong', comparison(0.40, ['different shape and closure'])],
    ['sku-correct', comparison(0.96, ['matching silhouette and closure hardware'])],
  ]);
  const decision = reuse.resolveSameVideoReuse({
    description: source,
    candidates: [promotedWrong, unpromotedCorrect],
    comparisons,
  });
  assert.equal(decision.canonical_key, 'sku-correct');
});

test('73-entry retrieval is bounded, reaches the evidence match at the tail and is order invariant', () => {
  const correct = rosterCandidate({ key: 'z-match', title: 'Acme Orbit White Bag', family: 'Orbit', color: 'white',
    features: ['light blue monogram', 'front padlock'], shape: ['structured vanity case'] });
  const noise = Array.from({ length: 72 }, (_, i) => rosterCandidate({ key: `noise-${i}`, title: `Acme Dark Bag ${i}`, family: `Group ${i}`, color: 'brown' }));
  const input = { description: description({ model_candidate: 'Wrong Family' }), candidates: [...noise, correct] };
  const shortlist = reuse.retrieveSameVideoRosterCandidates(input);
  assert.ok(shortlist.length <= reuse.ROSTER_VISUAL_CANDIDATE_LIMIT);
  assert.ok(shortlist.slice(0, 5).some(row => row.identity.canonical_key === 'z-match'));
  const reversed = reuse.retrieveSameVideoRosterCandidates({ ...input, candidates: [...input.candidates].reverse() });
  assert.deepEqual(shortlist.map(row => row.identity.canonical_key), reversed.map(row => row.identity.canonical_key));
});

test('missing or uncertain sibling comparison blocks live Exact, even when a nominee looks excellent', () => {
  const candidates = ['A', 'B'].map(key => rosterCandidate({ key, title: `Acme Orbit ${key}`, family: 'Orbit', color: 'white' }));
  for (const evidence of [undefined, { ...comparison(.98), confidence: .4 }, { ...comparison(NaN), confidence: .99 }]) {
    const comparisons = new Map([['A', comparison(.98)]]);
    if (evidence) comparisons.set('B', evidence);
    const result = reuse.resolveSameVideoReuse({ description: description(), candidates, comparisons, require_complete_comparisons: true });
    assert.equal(result.mapping, null);
    assert.equal(result.reason, 'incomplete_comparison');
  }
});

test('a deferred different category can be ruled out by independent pixels, never model guesses', () => {
  const a = rosterCandidate({ key: 'A', title: 'Acme Orbit White Bag', family: 'Orbit', color: 'white' });
  const b = rosterCandidate({ key: 'B', title: 'Acme Watch', family: 'Time' });
  b.identity.object_type = 'watch'; b.mapping.object_type = 'watch';
  const input = { description: description({ subcategory: 'watch' }), candidates: [a, b], require_complete_comparisons: true };
  const pixels = comparison(.98);
  assert.equal(reuse.resolveSameVideoReuse({ ...input, comparisons: new Map([['A', pixels]]) }).canonical_key, 'A');
  pixels.source.subtype.basis = 'description';
  assert.equal(reuse.resolveSameVideoReuse({ ...input, comparisons: new Map([['A', pixels]]) }).mapping, null);
});

test('contradictory source comparisons cannot selectively excuse an unseen rival', () => {
  const candidates = ['A', 'B', 'C'].map(key => rosterCandidate({ key, title: `Acme Orbit ${key}`, family: 'Orbit', color: 'brown' }));
  const white = comparison(.98); white.source.color = { value: 'white', confidence: .99, basis: 'image' };
  const brown = comparison(.4); brown.source.color = { value: 'brown', confidence: .99, basis: 'image' };
  assert.equal(reuse.resolveSameVideoReuse({ description: description(), candidates, comparisons: new Map([['A', white], ['B', brown]]), require_complete_comparisons: true }).mapping, null);
});
