import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onDecision } from '../product-tracks/run.mjs';
import { cases } from './corpus.mjs';
import { gate, summarize } from './metrics.mjs';

export function run() {
  const rows = cases.map(c => {
    const decision = onDecision(c);
    return {
      id: c.id, scenario: c.scenario, truth: c.truth,
      expected_class: c.expected_class, predicted_class: decision.track_id ?? 'NONE',
      result_class: decision.track_id ? 'EXACT' : null, status: 'OK',
    };
  });
  const metrics = summarize(rows);
  return { mode: 'frozen_evidence', metrics, gate: gate(metrics), rows };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = run();
  const output = process.argv[2];
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
  if (!report.gate.passed) process.exitCode = 1;
}
