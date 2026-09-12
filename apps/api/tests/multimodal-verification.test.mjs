import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';
import { apparelCases, benchmark, example } from './fixtures/apparel-benchmark.mjs';
const file = (name) => fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url));
const { verifyCandidate, rankVerified } = loadModule(file('candidate-verification'));
const { verifyProductCandidate, buildProductQueryVariants } = loadModule(file('commerce'));
const { applyBrandGate } = loadModule(file('brand-gate'));
const { applyAttributeInvariantGate } = loadModule(file('attribute-gate'));

test('multi-brand apparel benchmark: preserve credible candidates and reject explicit contradictions', (t) => {
  let before = 0, after = 0, falseAccepts = 0, falseRejects = 0;
  const cases = benchmark();
  for (const item of cases) {
    const legacy = verifyProductCandidate(item.description, item.candidate);
    const baseline = legacy ? applyBrandGate(item.description, applyAttributeInvariantGate(item.description, [legacy])).length > 0 : false;
    if (baseline === item.accept) before++;
    const actual = verifyCandidate(item.description, item.candidate, item.comparison).product;
    if (Boolean(actual) === item.accept) after++;
    else if (actual) falseAccepts++; else falseRejects++;
    assert.equal(Boolean(actual), item.accept, item.name);
    assert.notEqual(actual?.result_class, 'EXACT');
  }
  t.diagnostic(JSON.stringify({ brands: apparelCases.length, cases: cases.length, baseline_correct: before, verified_correct: after, falseAccepts, falseRejects }));
  assert.ok(after > before + 20, 'material benchmark improvement over prior gate');
});

test('query broadening retains brand-free retrieval for every benchmark category', () => {
  for (const spec of apparelCases) {
    const { description } = example(spec);
    const queries = buildProductQueryVariants(description);
    assert.ok(queries.some(({ query }) => !query.includes(spec[0]) && query.toLowerCase().includes(spec[1])), spec[0]);
    assert.ok(queries.some(({ query }) => query.includes(spec[0]) && !query.includes(spec[2])), 'identity query does not require color');
  }
});

test('provider rank, copied category/brand/model, price and merchant cannot create identity evidence', () => {
  const { description, candidate } = example(apparelCases[0]);
  const fake = { ...candidate, title: 'Unrelated item', metadata: {}, category: description.subcategory, brand: description.brand_candidate, model: 'model', result_class: 'EXACT' };
  assert.equal(verifyCandidate(description, fake).product, null);
});

test('type and audience alone are too weak when image comparison is unavailable', () => {
  const { description, candidate } = example(apparelCases[0]);
  candidate.title = 'Men t-shirt'; candidate.metadata = {};
  assert.equal(verifyCandidate(description, candidate).product, null);
  candidate.title = 'Men black t-shirt';
  assert.equal(verifyCandidate(description, candidate).product.result_class, 'SIMILAR');
});

test('strong multimodal agreement is LIKELY; missing brand and metadata-only matches are SIMILAR', () => {
  const { description, candidate, comparison } = example(apparelCases[0]);
  assert.equal(verifyCandidate(description, candidate, comparison).product.result_class, 'LIKELY');
  assert.equal(verifyCandidate(description, candidate).product.result_class, 'SIMILAR');
  comparison.candidate.brand.value = null;
  candidate.title = 'Black short sleeve t-shirt'; candidate.metadata = {};
  assert.equal(verifyCandidate(description, candidate, comparison).product.result_class, 'SIMILAR');
});

test('low-confidence alternate brand is an alternative, never original identity', () => {
  const { description, candidate, comparison } = example(apparelCases[0]);
  description.identity_confidence = 0.4;
  comparison.source.brand.confidence = 0.4;
  comparison.candidate.brand.value = 'Other';
  assert.equal(verifyCandidate(description, candidate, comparison).product.result_class, 'SIMILAR');
});

test('source pixels correct mistaken text subtype without context overriding them', () => {
  const { description, candidate, comparison } = example(apparelCases[0]);
  description.subcategory = 'Sweater';
  assert.ok(verifyCandidate(description, candidate, comparison, { title: 'Women red dresses review' }).product);
});

test('multicolor, unisex, partial crops and ambiguous sleeve evidence are uncertainty', () => {
  const { description, candidate, comparison } = example(apparelCases[0]);
  description.color = 'black and white';
  comparison.source.color.value = 'multicolor'; comparison.candidate.color.value = 'red';
  comparison.candidate.gender.value = 'unisex'; comparison.candidate.sleeve.value = null;
  assert.ok(verifyCandidate(description, candidate, comparison).product);
});

test('visual relevance precedes provider order and price; ties are deterministic', () => {
  const base = example(apparelCases[0]);
  const weak = verifyCandidate(base.description, { ...base.candidate, id: 'cheap', price: '1' }).product;
  const strong = verifyCandidate(base.description, { ...base.candidate, id: 'expensive', price: '500' }, base.comparison).product;
  assert.equal(rankVerified([weak, strong])[0].id, 'expensive');
  assert.deepEqual(rankVerified([weak, strong]).map((p) => p.id), rankVerified([strong, weak]).map((p) => p.id));
});

test('generic visual attributes cannot masquerade as distinctive identity evidence', () => {
  const { description, candidate, comparison } = example(apparelCases[0]);
  comparison.matching_details = ['short sleeve t-shirt', 'black color', 'crew neckline', 'solid black color scheme', 'short sleeves and regular casual fit'];
  assert.equal(verifyCandidate(description, candidate, comparison).product.result_class, 'SIMILAR');
});

test('a clearly different neckline is at most SIMILAR despite otherwise strong image agreement', () => {
  const { description, candidate, comparison } = example(apparelCases[0]);
  comparison.source.neckline = { value: 'crew neck', confidence: 0.95, basis: 'image' };
  comparison.candidate.neckline = { value: 'v-neck', confidence: 0.95, basis: 'image' };
  assert.equal(verifyCandidate(description, candidate, comparison).product.result_class, 'SIMILAR');
});

test('explicit kids products cannot match an adult selection, regardless of brand or visual score', () => {
  for (const spec of apparelCases) {
    const { description, candidate, comparison } = example(spec);
    candidate.title = `${spec[0]} Kids ${spec[1]}`; candidate.metadata = {};
    comparison.candidate.gender.value = null;
    assert.equal(verifyCandidate(description, candidate, comparison).product, null, spec[0]);
  }
});

test('weak visual similarity is removed even if broad metadata agrees', () => {
  const { description, candidate, comparison } = example(apparelCases[0]);
  for (const confidence of [0.65, 0.8, 0.95]) {
    for (const similarity of [0.15, 0.4, 0.59]) {
      assert.equal(verifyCandidate(description, candidate, { ...comparison, confidence, similarity }).product, null);
    }
  }
  assert.ok(verifyCandidate(description, candidate, { ...comparison, confidence: 0.4, similarity: 0.4 }).product,
    'unreliable comparison remains uncertainty');
});

test('cap sleeves contradict clearly sleeveless selections across brands', () => {
  for (const [brand] of apparelCases) {
    const { description, candidate } = example([brand, 'dress', 'black', 'sleeveless', 'women']);
    candidate.title = `${brand} Black Cap-Sleeved Dress`;
    assert.equal(verifyCandidate(description, candidate).product, null, brand);
  }
});

test('a secondary logo color is not evidence of a contradictory dominant color', () => {
  const { description, candidate } = example(apparelCases[0]);
  candidate.title = 'Nike t-shirt with red logo'; candidate.metadata = {};
  assert.ok(verifyCandidate(description, candidate).product);
});

test('strong matching model and images can establish LIKELY without invented distinctive details', () => {
  const { description, candidate, comparison } = example(apparelCases[0]);
  description.model_candidate = 'Family 123'; candidate.metadata.model = 'Family 123';
  comparison.matching_details = [];
  assert.equal(verifyCandidate(description, candidate, comparison).product.result_class, 'LIKELY');
});
