import assert from 'node:assert/strict';
import test from 'node:test';
import { cases, requiredScenarios } from './corpus.mjs';
import { summarize, gate } from './metrics.mjs';
import { run } from './run.mjs';
import { summarize as vpmSummary } from '../product-tracks/metrics.mjs';

test('every required outlier is represented; positives and NONE cannot disappear', () => {
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  for (const scenario of requiredScenarios) assert.ok(cases.some(c => c.scenario === scenario), scenario);
  for (const n of [1, 4]) {
    assert.ok(cases.some(c => c.candidates.length === n && c.truth === 'IN_ROSTER'));
    assert.ok(cases.some(c => c.candidates.length === n && c.truth === 'OUT_OF_ROSTER'));
  }
  for (const c of cases) {
    assert.ok(['IN_ROSTER', 'OUT_OF_ROSTER', 'AMBIGUOUS'].includes(c.truth));
    if (c.truth === 'IN_ROSTER') assert.ok(c.candidates.some(x => x.identity.canonical_key === c.expected_class), c.id);
    else assert.equal(c.expected_class, 'NONE');
  }
});

test('wrong in-roster SKU is a false Exact, just like a forced NONE assignment', () => {
  const metrics = summarize([
    { id: 'wrong-positive', scenario: 'multi', truth: 'IN_ROSTER', expected_class: 'A', predicted_class: 'B', result_class: 'EXACT', status: 'OK' },
    { id: 'wrong-negative', scenario: 'multi', truth: 'OUT_OF_ROSTER', expected_class: 'NONE', predicted_class: 'B', result_class: 'EXACT', status: 'OK' },
  ]);
  assert.equal(metrics.false_exact, 2);
  assert.equal(metrics.top1_accuracy, 0);
  assert.equal(gate(metrics).passed, false);
  assert.equal(vpmSummary([{ expected_track_id: 'A', on_track_id: 'B', decision_ms: 0, verification_requests: 0, verification_cost_usd: 0, commerce_calls: 0 }]).false_inherited_exact, 1);
});

test('always-NONE, empty, and blocked systems cannot pass', () => {
  const rows = cases.map(c => ({ ...c, predicted_class: 'NONE', result_class: null, status: 'OK' }));
  assert.equal(gate(summarize(rows)).passed, false);
  assert.equal(gate(summarize([])).passed, false);
  assert.equal(gate(summarize(rows.map(r => ({ ...r, status: 'PROVIDER_BLOCKED' })))).passed, false);
});

test('roster outlier hard gate: correct SKU or NONE, never wrong Exact', () => {
  const report = run();
  assert.deepEqual(report.metrics.false_exact_ids, [], JSON.stringify(report.metrics, null, 2));
  assert.equal(report.gate.passed, true, JSON.stringify(report.gate));
});
