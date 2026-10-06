import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { replay, validatePrediction, validateCase } from './replay.mjs';

function fixture() {
  const frame = Buffer.from('test-only frame bytes');
  return { id: 'hidden-id', scenario: 'single_sku', truth: 'IN_ROSTER', expected_class: 'A',
    roster: [{ canonical_key: 'A', title: 'Product A' }],
    input: { click: { x: .5, y: .5 }, frames: [{ path: 'frame.png', timestamp_ms: 1000, sha256: createHash('sha256').update(frame).digest('hex') }] } };
}

test('invalid predictions cannot become NONE successes', () => {
  for (const p of [null, { status: 'OK', predicted_class: 'Z', result_class: 'EXACT' },
    { status: 'OK', predicted_class: 'NONE', result_class: 'EXACT' }]) {
    assert.throws(() => validatePrediction(p, [{ canonical_key: 'A' }]));
  }
  validatePrediction({ status: 'OK', predicted_class: 'UNKNOWN', result_class: null }, [{ canonical_key: 'A' }]);
  assert.throws(() => validateCase({ ...fixture(), expected_class: 'B' }));
});

test('replay hides labels, requires complete coverage, and detects changed frame bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scoop-outlier-'));
  try {
    const manifest = join(dir, 'manifest.json');
    const adapter = join(dir, 'adapter.mjs');
    writeFileSync(join(dir, 'frame.png'), 'test-only frame bytes');
    writeFileSync(manifest, JSON.stringify({ version: 1, cases: [fixture()] }));
    writeFileSync(adapter, `export async function predict(input) {
      if ('expected_class' in input || 'truth' in input || 'scenario' in input || 'id' in input) throw new Error('labels leaked');
      if (input.frames[0].bytes.toString() !== 'test-only frame bytes') throw new Error('missing pixels');
      if (!input.answer_space.includes('NONE') || !input.answer_space.includes('UNKNOWN')) throw new Error('closed answer space');
      return {status:'OK', predicted_class:'A', result_class:'EXACT'};
    }`);
    const result = await replay(manifest, adapter);
    assert.equal(result.metrics.in_roster_accuracy, 1);
    assert.equal(result.gate.passed, false);
    assert.ok(result.gate.failures.includes('MISSING_SCENARIOS'));
    writeFileSync(join(dir, 'frame.png'), 'different bytes');
    await assert.rejects(replay(manifest, adapter), /hash mismatch/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
