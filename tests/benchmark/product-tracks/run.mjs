import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from '../../../apps/api/tests/helpers/load-ts.mjs';
import { cases } from './corpus.mjs';
import { summarize } from './metrics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const reuse = loadModule(resolve(here, '../../../apps/api/src/same-video-verified-reuse.ts'));
const mappingMod = loadModule(resolve(here, '../../../apps/api/src/verified-product-mapping.ts'));

function offDecision(testCase) {
  const mappings = testCase.candidates.map(({ mapping }) => ({ ...mapping, track_id: undefined }));
  const result = mappingMod.lookupVerifiedProductMapping({
    mappings,
    allowTestFixtures: true,
    platform: 'youtube',
    contentRef: 'youtube:frozen-vpm',
    timestampMs: testCase.timestamp_ms,
    description: testCase.description,
  });
  return result?.canonical_key ?? null;
}

export function onDecision(testCase) {
  const comparisons = new Map(Object.entries(testCase.comparisons ?? {}));
  const decision = reuse.resolveSameVideoReuse({
    description: testCase.description,
    candidates: testCase.candidates,
    // No recorded image comparison means legacy evidence-only evaluation.
    // Supplied comparison evidence must reach the production resolver.
    comparisons: comparisons.size ? comparisons : undefined,
  });
  return {
    track_id: decision.mapping ? decision.canonical_key : null,
    verification_requests: comparisons.size ? 1 : 0,
  };
}

export function runFrozenVpmBenchmark() {
  const rows = cases.map((testCase) => {
    const started = performance.now();
    const on = onDecision(testCase);
    const decisionMs = performance.now() - started;
    return {
      id: testCase.id,
      scenario: testCase.scenario,
      expected_track_id: testCase.expected_track_id,
      off_track_id: offDecision(testCase),
      on_track_id: on.track_id,
      candidate_count: testCase.candidates.length,
      decision_ms: decisionMs,
      verification_requests: on.verification_requests,
      verification_cost_usd: 0,
      commerce_calls: 0,
    };
  });
  return { rows, metrics: summarize(rows) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runFrozenVpmBenchmark();
  console.log(JSON.stringify(result, null, 2));
  if (result.metrics.false_inherited_exact > 0) {
    console.error(`FAIL: ${result.metrics.false_inherited_exact} false VPM-inherited Exact result(s)`);
    process.exitCode = 1;
  }
}
