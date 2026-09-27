import assert from 'node:assert/strict';
import test from 'node:test';
import { runFrozenVpmBenchmark } from './run.mjs';
import { cases } from './corpus.mjs';

test('frozen VPM corpus covers required fidelity scenarios', () => {
  const scenarios = new Set(cases.map((entry) => entry.scenario));
  for (const required of ['presentation', 'multiple_similar', 'disappear_reappear', 'occlusion', 'weak_ocr', 'movie_cut', 'adversarial_lookalike']) {
    assert.equal(scenarios.has(required), true, `missing scenario: ${required}`);
  }
  assert.ok(cases.length >= 10);
});

test('VPM hard gate: no wrong inherited Exact', () => {
  const { rows, metrics } = runFrozenVpmBenchmark();
  const falseExacts = rows.filter((row) => !row.expected_track_id && row.on_track_id);
  assert.deepEqual(falseExacts, []);
  assert.equal(metrics.false_inherited_exact, 0);
});

test('every expected promoted track is recovered in the frozen fidelity corpus', () => {
  const { rows, metrics } = runFrozenVpmBenchmark();
  const misses = rows.filter((row) => row.expected_track_id && row.on_track_id !== row.expected_track_id);
  assert.deepEqual(misses, []);
  assert.equal(metrics.persistence_recall, 1);
});

test('multi-product observations resolve the correct promoted track', () => {
  const { metrics } = runFrozenVpmBenchmark();
  assert.equal(metrics.multi_track_accuracy, 1);
});
