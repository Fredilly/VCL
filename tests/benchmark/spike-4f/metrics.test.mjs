import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCorpus } from './corpus.mjs';
import { validateCorpus, scoreSelection, summarize, percentile, digest, candidateKey } from './metrics.mjs';

const selection = createCorpus().selections[0];
function example(classes = ['LIKELY'], correctness = [true]) {
  const observation = { selection_id: selection.id, latency_ms: 10, response: { state: 'RESULTS', products: classes.map((result_class, i) => ({
    id: String(i), provider: 'ebay', provenance: 'ebay:browse', result_class, title: `candidate ${i}` })) } };
  const review = { observation_sha256: digest(observation), notes: 'Independent fixture labels',
    candidates: Object.fromEntries(observation.response.products.map((p, i) => [candidateKey(p), { correct: correctness[i], useful: i === 0, notes: 'Fixed adjudication' }])) };
  return { observation, review };
}
test('corpus is balanced with independent known/unknown identity partitions and nearby cases', () => {
  const corpus = validateCorpus(createCorpus());
  assert.equal(corpus.selections.length, 30);
  for (const category of new Set(corpus.selections.map(s => s.category))) assert.equal(corpus.selections.filter(s => s.category === category).length, 6);
  assert.equal(corpus.selections.filter(s => s.ground_truth.status === 'known').length, 20);
  assert.equal(corpus.selections.filter(s => s.nearby_timestamps?.length).length, 5);
  const duplicate = structuredClone(corpus); duplicate.selections[1].id = duplicate.selections[0].id;
  assert.throws(() => validateCorpus(duplicate), /Duplicate/);
});
test('no EXACT claims is undefined precision, never perfect precision', () => {
  const { observation, review } = example();
  const metrics = summarize([scoreSelection(selection, observation, review)]);
  assert.equal(metrics.exact_precision.value, null);
  assert.equal(metrics.likely_precision.value, 1);
  assert.equal(metrics.false_exact_rate.value, 0);
  assert.equal(metrics.provider_failure_rate.value, null);
});
test('false EXACT is surfaced even below a correct top candidate', () => {
  const { observation, review } = example(['LIKELY', 'EXACT'], [true, false]);
  const row = scoreSelection(selection, observation, review);
  assert.equal(row.false_exact, true);
  const metrics = summarize([row]);
  assert.equal(metrics.false_exact_rate.value, 1);
  assert.deepEqual(metrics.all_returned_exact, { claims: 1, false: 1, unknown: 0 });
});
test('unknown identity never improves precision; unverified EXACT remains a distinct trust risk', () => {
  const unknown = { ...selection, ground_truth: { status: 'unknown', identity: null } };
  const { observation, review } = example(['EXACT'], [null]);
  const row = scoreSelection(unknown, observation, review);
  const metrics = summarize([row]);
  assert.equal(row.top_candidate_correct, null);
  assert.equal(row.false_exact, false);
  assert.equal(row.unverified_exact, true);
  assert.equal(metrics.exact_precision.denominator, 0);
  assert.equal(metrics.exact_precision.unknown, 1);
  review.candidates['ebay:browse:0'].correct = true;
  assert.throws(() => scoreSelection(unknown, observation, review), /Unknown source/);
});
test('usefulness examines lower ranks and does not imply original identity', () => {
  const { observation, review } = example(['SIMILAR', 'SIMILAR'], [false, false]);
  review.candidates['ebay:browse:0'].useful = false;
  review.candidates['ebay:browse:1'].useful = true;
  const row = scoreSelection(selection, observation, review);
  assert.equal(row.top_candidate_correct, false);
  assert.equal(row.useful_result, true);
});
test('stale/missing adjudication and missing provenance fail closed', () => {
  const { observation, review } = example();
  observation.response.products[0].title = 'Changed candidate';
  assert.throws(() => scoreSelection(selection, observation, review), /stale/);
  review.observation_sha256 = digest(observation);
  delete review.candidates['ebay:browse:0'];
  assert.throws(() => scoreSelection(selection, observation, review), /Unreviewed/);
  delete observation.response.products[0].provenance;
  review.observation_sha256 = digest(observation);
  assert.throws(() => scoreSelection(selection, observation, review), /provenance/);
});
test('failed requests stay in denominator and remain distinguishable from true no-results', () => {
  const observation = { selection_id: selection.id, latency_ms: 600, error: { stage: 'resolver' },
    provider_observations: [{ observable: true, failed: true }, { observable: true, failed: false }, { observable: false, failed: true }] };
  const row = scoreSelection(selection, observation, { observation_sha256: digest(observation), candidates: {}, notes: 'Timeout' });
  const metrics = summarize([row]);
  assert.equal(row.state, 'REQUEST_FAILED');
  assert.equal(metrics.no_result_rate.value, 1);
  assert.equal(metrics.request_failures, 1);
  assert.equal(metrics.provider_failure_rate.value, .5);
});
test('nearest-rank P50 and P95 include slow tails and null on no measurements', () => {
  assert.equal(percentile([], .95), null);
  assert.equal(percentile([100, 1, 2, 3], .5), 2);
  assert.equal(percentile([100, 1, 2, 3], .95), 100);
  assert.equal(percentile(Array.from({ length: 30 }, (_, i) => i + 1), .95), 29);
});
