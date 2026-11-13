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
  // A sibling nobody looked at (no comparison, or an unusable one) is missing evidence.
  for (const evidence of [undefined, { ...comparison(NaN), confidence: .99 }]) {
    const comparisons = new Map([['A', comparison(.98)]]);
    if (evidence) comparisons.set('B', evidence);
    const result = reuse.resolveSameVideoReuse({ description: description(), candidates, comparisons, require_complete_comparisons: true });
    assert.equal(result.mapping, null);
    assert.equal(result.reason, 'incomplete_comparison');
  }
  // A sibling that was examined but scored just as high, uncertainly, still blocks
  // Exact: there is no match to act on, only a front-runner that must win a
  // head-to-head round, and it cannot while the sibling stays this close.
  const comparisons = new Map([['A', comparison(.98)], ['B', { ...comparison(.98), confidence: .4 }]]);
  const held = reuse.resolveSameVideoReuse({ description: description(), candidates, comparisons, require_complete_comparisons: true });
  assert.equal(held.mapping, null);
  assert.equal(held.canonical_key, null);
  assert.equal(held.reason, 'head_to_head_required');
  assert.equal(held.front_runner.canonical_key, 'A');
  assert.equal(JSON.stringify(held.head_to_head_rivals), JSON.stringify(['B']));
  const round = reuse.confirmHeadToHead({ decision: held, comparisons });
  assert.equal(round.mapping, null);
  assert.equal(round.reason, 'ambiguous');
});

// ---- coverage: examined + head-to-head, instead of "the model must be 0.9-sure of every rejection" ----

const roster = keys => keys.map(key => rosterCandidate({ key, title: `Acme Orbit ${key}`, family: 'Orbit', color: 'white' }));
const live = (candidates, comparisons) => reuse.resolveSameVideoReuse({ description: description(), candidates, comparisons, require_complete_comparisons: true });
// How a real verifier answers: sure of the match, only fairly sure of each rejection.
const unsure = similarity => ({ ...comparison(similarity), confidence: .75 });

test('a fully examined roster with one strict winner yields a front-runner, never a match on its own', () => {
  const candidates = roster(['A', 'B', 'C', 'D', 'E']);
  const comparisons = new Map([['A', comparison(.95)], ['B', unsure(.6)], ['C', unsure(.4)], ['D', unsure(.3)], ['E', unsure(.1)]]);
  const held = live(candidates, comparisons);
  // Before: 'incomplete_comparison' on every click, because no rejection reached 0.9 confidence.
  assert.equal(held.reason, 'head_to_head_required');
  assert.equal(held.mapping, null);
  assert.equal(held.front_runner.canonical_key, 'A');
  // The three closest rivals go into the round, closest first.
  assert.equal(JSON.stringify(held.head_to_head_rivals), JSON.stringify(['B', 'C', 'D']));
  assert.equal(reuse.ROSTER_RIVAL_MARGIN, 0.15);
});

test('the head-to-head round promotes the front-runner only when it wins again, clearly', () => {
  const candidates = roster(['A', 'B', 'C']);
  const held = live(candidates, new Map([['A', comparison(.95)], ['B', unsure(.7)], ['C', unsure(.3)]]));
  const round = entries => reuse.confirmHeadToHead({ decision: held, comparisons: new Map(entries) });

  const won = round([['A', comparison(.93)], ['B', unsure(.5)], ['C', unsure(.2)]]);
  assert.equal(won.reason, 'visual_confirmed');
  assert.equal(won.canonical_key, 'A');
  assert.equal(won.mapping.product_id, 'A');
  // Reported strength is the weaker of the two looks.
  assert.equal(won.visual_similarity, .93);

  // A rival within the margin in the round: too close to call.
  const close = round([['A', comparison(.93)], ['B', unsure(.80)], ['C', unsure(.2)]]);
  assert.deepEqual([close.mapping, close.reason], [null, 'ambiguous']);
  assert.equal(JSON.stringify(close.rival_keys), JSON.stringify(['A', 'B']));
  // Exactly at the margin is clear; one step inside is not.
  assert.equal(round([['A', comparison(.95)], ['B', unsure(.80)], ['C', unsure(.2)]]).reason, 'visual_confirmed');
  // The front-runner no longer passes the strict check on a second look.
  assert.deepEqual([round([['A', comparison(.85)], ['B', unsure(.3)], ['C', unsure(.2)]]).mapping, round([['A', comparison(.85)], ['B', unsure(.3)], ['C', unsure(.2)]]).reason], [null, 'ambiguous']);
  assert.equal(round([['A', { ...comparison(.95), confidence: .8 }], ['B', unsure(.3)], ['C', unsure(.2)]]).reason, 'ambiguous');
  // A rival missing from the round, or no round at all, is never a win.
  assert.deepEqual([round([['A', comparison(.95)], ['B', unsure(.3)]]).mapping, round([['A', comparison(.95)], ['B', unsure(.3)]]).reason], [null, 'incomplete_comparison']);
  assert.equal(round([]).reason, 'incomplete_comparison');
  // A decision that is not waiting for a round cannot be promoted by one.
  assert.equal(reuse.confirmHeadToHead({ decision: { mapping: null, canonical_key: null, confidence: 0, reason: 'ambiguous' }, comparisons: new Map([['A', comparison(.99)]]) }).mapping, null);
});

test('an unexamined candidate blocks even a clear winner; too many close rivals is ambiguous outright', () => {
  const candidates = roster(['A', 'B', 'C', 'D', 'E', 'F']);
  // F was never compared (failed batch / missing image).
  const missing = live(candidates, new Map([['A', comparison(.97)], ['B', unsure(.2)], ['C', unsure(.2)], ['D', unsure(.2)], ['E', unsure(.2)]]));
  assert.deepEqual([missing.mapping, missing.reason], [null, 'incomplete_comparison']);
  assert.equal(JSON.stringify(reuse.unexaminedRosterCandidateKeys({ candidates, comparisons: new Map([['A', comparison(.97)], ['B', unsure(.2)]]) })), JSON.stringify(['C', 'D', 'E', 'F']));
  // Four rivals within the margin cannot fit one round.
  const crowded = live(candidates, new Map([['A', comparison(.95)], ['B', unsure(.9)], ['C', unsure(.9)], ['D', unsure(.85)], ['E', unsure(.85)], ['F', unsure(.2)]]));
  assert.deepEqual([crowded.mapping, crowded.reason], [null, 'ambiguous']);
  // No strict winner at all: unchanged, still incomplete.
  const nobody = live(candidates, new Map(candidates.map(row => [row.identity.canonical_key, unsure(.85)])));
  assert.deepEqual([nobody.mapping, nobody.reason], [null, 'incomplete_comparison']);
  // Two strict winners: unchanged, never a match.
  const two = live(roster(['A', 'B', 'C']), new Map([['A', comparison(.95)], ['B', comparison(.95)], ['C', unsure(.2)]]));
  assert.equal(two.mapping, null);
});

test('fully settled roster still requires independent head-to-head confirmation', () => {
  const candidates = roster(['A', 'B']);
  const settled = live(candidates, new Map([['A', comparison(.97)], ['B', comparison(.2)]]));
  assert.equal(settled.reason, 'head_to_head_required');
  assert.equal(settled.canonical_key, null);
  const second = reuse.confirmHeadToHead({ decision: settled, comparisons: new Map([['A', comparison(.97)], ['B', comparison(.2)]]) });
  assert.equal(second.reason, 'visual_confirmed');
  assert.equal(second.canonical_key, 'A');
});

test('probable roster candidates: strongly alike, specific, uncontradicted; best first, at most three', () => {
  const candidates = roster(['A', 'B', 'C', 'D', 'E', 'F']);
  const strong = (similarity, confidence = .85) => ({ ...comparison(similarity), confidence });
  const contradicted = strong(.9);
  contradicted.source = { ...contradicted.source, color: { value: 'white', confidence: .95, basis: 'image' } };
  contradicted.candidate = { ...contradicted.candidate, color: { value: 'black', confidence: .95, basis: 'image' } };
  const comparisons = new Map([
    ['A', strong(.85)], ['B', strong(.9)], ['C', strong(.75)],            // C below the similarity bar
    ['D', strong(.95, .7)],                                               // D not confident enough
    ['E', contradicted],                                                  // E contradicted by pixels
    ['F', { ...strong(.88), matching_details: ['black'] }],               // F has no specific shared detail
  ]);
  const probable = reuse.probableRosterCandidates({ candidates, comparisons });
  assert.deepEqual(probable.map(row => row.candidate.identity.canonical_key), ['B', 'A']);
  assert.equal(reuse.probableRosterCandidates({ candidates, comparisons: new Map() }).length, 0);
  const many = new Map(candidates.map((row, index) => [row.identity.canonical_key, strong(.9 - index * .01)]));
  assert.equal(reuse.probableRosterCandidates({ candidates, comparisons: many }).length, 3);
});

test('a deferred different category can be ruled out by independent pixels, never model guesses', () => {
  const a = rosterCandidate({ key: 'A', title: 'Acme Orbit White Bag', family: 'Orbit', color: 'white' });
  const b = rosterCandidate({ key: 'B', title: 'Acme Watch', family: 'Time' });
  b.identity.object_type = 'watch'; b.mapping.object_type = 'watch';
  const input = { description: description({ subcategory: 'watch' }), candidates: [a, b], require_complete_comparisons: true };
  const pixels = comparison(.98);
  const first = reuse.resolveSameVideoReuse({ ...input, comparisons: new Map([['A', pixels]]) });
  assert.equal(first.reason, 'head_to_head_required');
  assert.equal(reuse.confirmHeadToHead({ decision: first, comparisons: new Map([['A', pixels]]) }).canonical_key, 'A');
  pixels.source.subtype.basis = 'description';
  assert.equal(reuse.resolveSameVideoReuse({ ...input, comparisons: new Map([['A', pixels]]) }).mapping, null);
});

test('contradictory source comparisons cannot selectively excuse an unseen rival', () => {
  const candidates = ['A', 'B', 'C'].map(key => rosterCandidate({ key, title: `Acme Orbit ${key}`, family: 'Orbit', color: 'brown' }));
  const white = comparison(.98); white.source.color = { value: 'white', confidence: .99, basis: 'image' };
  const brown = comparison(.4); brown.source.color = { value: 'brown', confidence: .99, basis: 'image' };
  assert.equal(reuse.resolveSameVideoReuse({ description: description(), candidates, comparisons: new Map([['A', white], ['B', brown]]), require_complete_comparisons: true }).mapping, null);
});

test('model readings contradict only when they cannot be the same product; naming detail is not a contradiction', () => {
  const evidence = loadModule(new URL('../src/verification-evidence.ts', import.meta.url).pathname);
  const contradict = (a, b) => reuse.modelNamesContradict(evidence.canonical('model', a), evidence.canonical('model', b));
  // Same product named with more or less detail.
  for (const [a, b] of [['Side Trunk', 'Side Trunk PM'], ['Speedy', 'Speedy Bandoulière 25'], ['Trunk', 'Side Trunk'], ['Neverfull MM', 'neverfull mm']]) {
    assert.equal(contradict(a, b), false, `${a} / ${b}`);
    assert.equal(contradict(b, a), false, `${b} / ${a}`);
  }
  // Different products, sizes or codes still veto.
  for (const [a, b] of [['Side Trunk PM', 'Side Trunk MM'], ['Speedy 25', 'Speedy 30'], ['Neverfull', 'CarryAll'], ['M46197', 'M46234'], ['II5381-417', 'II5381-418']]) {
    assert.equal(contradict(a, b), true, `${a} / ${b}`);
  }
  // A code and a name are different kinds of reference: neither supports nor contradicts.
  for (const [a, b] of [['M14526', 'Trunkie'], ['FP-1977706', 'Side Trunk'], ['Speedy 25', 'M41113']]) assert.equal(contradict(a, b), false, `${a} / ${b}`);

  // Through the strict check: a naming-detail difference no longer vetoes; a real one still does.
  const withModels = (source, candidate) => ({ ...comparison(.95), source: { ...comparison(.95).source, model: { value: source, confidence: .9, basis: 'image' } },
    candidate: { ...comparison(.95).candidate, model: { value: candidate, confidence: .9, basis: 'metadata' } } });
  assert.equal(reuse.strictVisualOutcome(withModels('Side Trunk', 'Side Trunk PM')), 'confirmed');
  assert.equal(reuse.strictVisualOutcome(withModels('Side Trunk MM', 'Side Trunk PM')), 'contradiction_model');
  assert.equal(reuse.strictVisualOutcome(withModels('CarryAll', 'Neverfull MM')), 'contradiction_model');
  assert.equal(reuse.criticalContradictionKey(withModels('Side Trunk', 'FP-1977706')), null);
  // Other attributes keep the shared, stricter rule.
  const colours = comparison(.95);
  colours.source = { ...colours.source, color: { value: 'white', confidence: .95, basis: 'image' } };
  colours.candidate = { ...colours.candidate, color: { value: 'black', confidence: .95, basis: 'image' } };
  assert.equal(reuse.strictVisualOutcome(colours), 'contradiction_color');
});

test('strong roster commerce hypothesis survives an uncompleted head-to-head round', () => {
  const candidate = rosterCandidate({ key: 'strong', title: 'Acme Orbit White Bag', family: 'Orbit', color: 'white' });
  const pixels = comparison(.97);
  // With one candidate the identity resolver correctly refuses EXACT without
  // an independent second look, but that is not grounds to discard the query.
  const first = reuse.resolveSameVideoReuse({ description: description(), candidates: [candidate],
    comparisons: new Map([['strong', pixels]]) });
  assert.equal(first.reason, 'head_to_head_required');
  assert.equal(first.mapping, null);
  assert.equal(reuse.rosterCommerceHypothesisAllowed({ description: description(), candidate, comparison: pixels }), true);

  const contradiction = { ...pixels, source: { ...pixels.source,
    color: { value: 'black', confidence: .99, basis: 'image' } },
    candidate: { ...pixels.candidate, color: { value: 'white', confidence: .99, basis: 'image' } } };
  assert.equal(reuse.rosterCommerceHypothesisAllowed({ description: description(), candidate, comparison: contradiction }), false);
});
