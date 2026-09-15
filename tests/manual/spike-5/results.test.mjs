import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { summarize } from './metrics.mjs';

const read = async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));

test('Spike 5 results cover the unchanged frozen protocol and pass the declared trust rule', async () => {
  const [protocol, result] = await Promise.all([read('./cases.json'), read('./results.json')]);
  assert.equal(protocol.cases.length, 10);
  assert.equal(result.completed_cases.length, 10);
  assert.deepEqual(result.uncompleted_case_ids, []);

  const actual = new Map(result.completed_cases.map((row) => [row.id, row]));
  for (const planned of protocol.cases) {
    const row = actual.get(planned.id);
    assert.ok(row, `missing result for ${planned.id}`);
    assert.equal(row.source, planned.source);
    assert.equal(row.timestamp_s, planned.timestamp_s);
    assert.equal(row.selected_item, planned.selected_item);
    assert.ok(['SIMILAR', 'NO_RESULT'].includes(row.classification));
  }

  const metrics = summarize(result.completed_cases);
  assert.equal(metrics.pass, true);
  assert.equal(metrics.useful_or_graceful_sessions, 10);
  assert.equal(metrics.false_exact, 0);
  assert.equal(metrics.false_likely, 0);
  assert.equal(metrics.p50_latency_ms, 57059);
  assert.equal(metrics.p95_latency_ms, 74338);
});
