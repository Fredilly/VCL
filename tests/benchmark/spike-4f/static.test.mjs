import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCorpus } from './corpus.mjs';
import { runStatic } from './static.mjs';
import { scoreSelection, summarize } from './metrics.mjs';

test('unchanged production resolver executes all 30 fixtures offline and repeats semantic results', async () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('Static benchmark must never access the network'); };
  try {
    const corpus = createCorpus();
    const first = await runStatic(corpus);
    const second = await runStatic(corpus);
    const semantic = run => run.observations.map(({ latency_ms, ...observation }) => observation);
    assert.deepEqual(semantic(first), semantic(second));
    const rows = corpus.selections.map((s, i) => scoreSelection(s, first.observations[i], first.reviews[s.id]));
    const metrics = summarize(rows);
    assert.equal(metrics.selections, 30);
    assert.equal(metrics.all_returned_exact.claims, 0, 'Production evidence cannot independently prove an exact SKU');
    assert.equal(metrics.multi_frame_used, 5);
    assert.equal(metrics.multi_frame_contributed, 5);
    assert.equal(metrics.provider_failure_rate.numerator, 5);
    assert.equal(metrics.likely_precision.numerator, 10);
    assert.equal(metrics.likely_precision.denominator, 10, 'All true identities survive; lookalikes remain useful SIMILAR');
    assert.deepEqual(metrics.false_likely_selections, []);
    assert.equal(metrics.useful_result_rate.numerator, 24);
    for (const row of rows.filter(r => r.multi_frame_used)) {
      assert.equal(row.multi_frame.field_sources.brand_candidate, 'next');
      assert.equal(row.multi_frame.frames[1].status, 'object_not_confirmed');
    }
  } finally { globalThis.fetch = fetchBefore; }
});
