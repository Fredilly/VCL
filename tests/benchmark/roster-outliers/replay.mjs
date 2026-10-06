import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gate, summarize } from './metrics.mjs';
import { requiredScenarios } from './corpus.mjs';

export function validateCase(c) {
  if (!c.id || !requiredScenarios.includes(c.scenario)) throw new Error('Invalid case ID/scenario');
  if (!['IN_ROSTER', 'OUT_OF_ROSTER', 'AMBIGUOUS'].includes(c.truth)) throw new Error(`${c.id}: invalid truth`);
  if (!Array.isArray(c.roster) || !c.roster.length) throw new Error(`${c.id}: missing roster`);
  const keys = c.roster.map(r => r.canonical_key);
  if (new Set(keys).size !== keys.length || keys.some(k => !k || ['NONE', 'UNKNOWN'].includes(k))) throw new Error(`${c.id}: invalid roster keys`);
  if (c.truth === 'IN_ROSTER' ? !keys.includes(c.expected_class) : c.expected_class !== 'NONE') throw new Error(`${c.id}: invalid ground truth`);
  if (!c.input || !Array.isArray(c.input.frames) || !c.input.frames.length) throw new Error(`${c.id}: frames required`);
  if (!c.input.click || !['x', 'y'].every(k => Number.isFinite(c.input.click[k]) && c.input.click[k] >= 0 && c.input.click[k] <= 1)) throw new Error(`${c.id}: normalized click required`);
  for (const f of c.input.frames) {
    if (!f.path || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isFinite(f.timestamp_ms) || f.timestamp_ms < 0) throw new Error(`${c.id}: frozen frame/hash/timestamp required`);
  }
}

export function validatePrediction(p, roster) {
  if (!p || !['OK', 'PROVIDER_BLOCKED', 'SYSTEM_FAIL'].includes(p.status)) throw new Error('Invalid prediction status');
  if (p.status !== 'OK') return;
  if (!['NONE', 'UNKNOWN', ...roster.map(r => r.canonical_key)].includes(p.predicted_class)) throw new Error('Prediction outside answer space');
  if (![null, 'EXACT', 'SIMILAR', 'RELATED'].includes(p.result_class)) throw new Error('Invalid result class');
  if (['NONE', 'UNKNOWN'].includes(p.predicted_class) && p.result_class !== null) throw new Error('Abstention cannot claim a product result');
}

export async function replay(manifestPath, adapterPath) {
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.version !== 1 || !manifest.cases?.length) throw new Error('Empty/unsupported manifest');
  if (new Set(manifest.cases.map(c => c.id)).size !== manifest.cases.length) throw new Error('Duplicate case IDs');
  // Validate the entire corpus before any inference or paid provider call.
  const inputs = manifest.cases.map(c => {
    validateCase(c);
    const frames = c.input.frames.map(f => {
      const bytes = readFileSync(resolve(dirname(manifestPath), f.path));
      if (createHash('sha256').update(bytes).digest('hex') !== f.sha256) throw new Error(`${c.id}: frame hash mismatch`);
      return { timestamp_ms: f.timestamp_ms, bytes };
    });
    // Never pass labels, scenario, IDs or expected output to the model adapter.
    return { frames, click: c.input.click, context: c.input.context ?? {}, roster: c.roster,
      answer_space: [...c.roster.map(r => r.canonical_key), 'NONE', 'UNKNOWN'] };
  });
  const coverage = requiredScenarios.filter(s => !manifest.cases.some(c => c.scenario === s));
  const { predict } = await import(pathToFileURL(resolve(adapterPath)).href);
  if (typeof predict !== 'function') throw new Error('Adapter must export predict(input, { signal })');
  const rows = [];
  for (const [i, c] of manifest.cases.entries()) {
    let prediction;
    const controller = new AbortController();
    let timer;
    try {
      prediction = await Promise.race([
        predict(inputs[i], { signal: controller.signal }),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('TIMEOUT')); }, 30000); }),
      ]);
      validatePrediction(prediction, c.roster);
    } catch {
      // Exceptions/malformed output are failures, never successful NONE.
      prediction = { status: 'SYSTEM_FAIL', predicted_class: 'UNKNOWN', result_class: null };
    } finally { clearTimeout(timer); }
    rows.push({ id: c.id, scenario: c.scenario, truth: c.truth, expected_class: c.expected_class,
      status: prediction.status, predicted_class: prediction.predicted_class, result_class: prediction.result_class });
  }
  const metrics = summarize(rows);
  const result = gate(metrics, { top1: .95, noneRecall: .95, ambiguity: 1 });
  if (coverage.length) { result.passed = false; result.failures.push('MISSING_SCENARIOS'); }
  for (const n of [1, 4]) for (const truth of ['IN_ROSTER', 'OUT_OF_ROSTER']) {
    if (!manifest.cases.some(c => c.roster.length === n && c.truth === truth)) {
      result.passed = false; result.failures.push(`MISSING_${n}_SKU_${truth}`);
    }
  }
  return { mode: 'frame_replay', manifest_sha256: createHash('sha256').update(manifestBytes).digest('hex'),
    missing_scenarios: coverage, metrics, gate: result, rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifest, adapter, output] = process.argv.slice(2);
  if (!manifest || !adapter || !output) throw new Error('Usage: replay.mjs manifest.json adapter.mjs NEW-report.json');
  const result = await replay(resolve(manifest), resolve(adapter));
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(result.metrics, null, 2));
  if (!result.gate.passed) process.exitCode = 1;
}
