import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mod = loadModule(resolve(here, '../../extension/lib/vpm-quality-recovery.ts'));

test('nearby VPM recovery is attempted only for one rejected same-video memory', () => {
  assert.equal(mod.shouldAttemptVpmNearbyRecovery({
    verified_mapping: { hit: false, reuse: 'same_video', reason: 'visual_rejected', candidates_compared: 1 },
  }), true);
});

test('nearby VPM recovery does not run for ambiguous or unrelated observations', () => {
  for (const verified_mapping of [
    { hit: false, reuse: 'same_video', reason: 'ambiguous', candidates_compared: 2 },
    { hit: false, reuse: 'same_video', reason: 'no_candidate', candidates_compared: 0 },
    { hit: false, reuse: 'same_video', reason: 'visual_rejected', candidates_compared: 2 },
    { hit: true, reuse: 'same_video', reason: 'visual_confirmed', candidates_compared: 1 },
  ]) {
    assert.equal(mod.shouldAttemptVpmNearbyRecovery({ verified_mapping }), false);
  }
});
