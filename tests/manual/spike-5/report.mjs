import { readFile } from 'node:fs/promises';
import { summarize } from './metrics.mjs';

const result = JSON.parse(await readFile(new URL('./results.json', import.meta.url), 'utf8'));
console.log(JSON.stringify({
  status: result.status,
  metrics: summarize(result.completed_cases),
  incomplete: result.uncompleted_case_ids,
  capture_diagnosis: result.capture_diagnosis,
  interaction_checks: result.interaction_checks,
}, null, 2));
