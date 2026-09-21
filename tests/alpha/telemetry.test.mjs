import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from '../../apps/api/tests/helpers/load-ts.mjs';

test('alpha telemetry rejects sensitive/arbitrary identifiers and emits only bounded metrics', () => {
  const logs = [];
  const mod = loadModule(new URL('../../apps/api/src/alpha-telemetry.ts', import.meta.url).pathname, {
    console: { log: value => logs.push(JSON.parse(value)) },
  });
  const telemetry = mod.normalizeAlphaTelemetry({ event_id: 'evt-1', session_id: 'session-1', interaction_started_at: Date.now() - 50 });
  mod.recordAlphaScoop({ telemetry, state: 'RESULTS', totalMs: 12, providersUsed: ['ebay'],
    resultRows: [{ id: 'p1', result_class: 'LIKELY' }], commerceCalls: { ebay: 1 } });
  assert.equal(logs[0].event, 'ALPHA_SCOOP');
  assert.equal(logs[0].results[0].result_class, 'LIKELY');
  assert.ok(!('image' in logs[0]));
  assert.ok(!('url' in logs[0]));
  assert.throws(() => mod.normalizeAlphaTelemetry({ event_id: 'bad id with spaces', session_id: 's', interaction_started_at: 1 }));
});
