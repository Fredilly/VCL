import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases } from './corpus.mjs';
import { promotedCases } from './promoted.mjs';
import { onDecision } from '../product-tracks/run.mjs';
import { summarize, gate } from './metrics.mjs';

export function runOrderStress() {
  const rows = [];
  const unstable = [];
  for (const c of [...cases,...promotedCases()]) {
    const predictions = [];
    // Exercise every cyclic position plus reversal without changing evidence.
    const orders = [...c.candidates.map((_,i) => [...c.candidates.slice(i),...c.candidates.slice(0,i)]),[...c.candidates].reverse()];
    const seen = new Set();
    for (const candidates of orders) {
      const signature = JSON.stringify(candidates.map(r => r.identity.canonical_key));
      if (seen.has(signature)) continue;
      seen.add(signature);
      const d = onDecision({...c,candidates});
      const predicted = d.track_id ?? 'NONE'; predictions.push(predicted);
      rows.push({id:`${c.id}/order-${seen.size}`,scenario:c.scenario,truth:c.truth,expected_class:c.expected_class,
        predicted_class:predicted,result_class:d.track_id ? 'EXACT' : null,status:'OK'});
    }
    if (new Set(predictions).size > 1) unstable.push(c.id);
  }
  const metrics = summarize(rows); const result = gate(metrics);
  if (unstable.length) { result.passed = false; result.failures.push('ROSTER_ORDER_INSTABILITY'); }
  return {mode:'evidence_order_stress_not_pixel_accuracy',unique_cases:cases.length+promotedCases().length,
    metrics,unstable_case_ids:unstable,gate:result,rows};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runOrderStress();
  if (process.argv[2]) writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report,null,2));
  if (!report.gate.passed) process.exitCode=1;
}
