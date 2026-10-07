import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { validateChaosManifest, chaosInput, orderVariants, validateChaosPrediction, assessChaos, rosterBucket } from './chaos.mjs';

export async function replayChaos(manifestPath, adapterPath, { timeoutMs = 30000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) throw new Error('Invalid timeout');
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  validateChaosManifest(manifest);
  // Preflight all source AND catalog references before loading the adapter.
  const load = f => {
    const bytes = readFileSync(resolve(dirname(manifestPath),f.path));
    if (createHash('sha256').update(bytes).digest('hex') !== f.sha256) throw new Error('Frozen image hash mismatch');
    return bytes;
  };
  const inputs = manifest.cases.map(c => chaosInput(c,load));
  const adapterBytes = readFileSync(adapterPath);
  const { predict } = await import(pathToFileURL(resolve(adapterPath)).href);
  if (typeof predict !== 'function') throw new Error('Adapter must export predict');
  const rows = [];
  let cancelled = false;
  for (const [i,c] of manifest.cases.entries()) {
    for (const [order,input] of orderVariants(inputs[i]).entries()) {
      let p;
      let failure = null;
      let timer;
      const controller = new AbortController();
      const started = performance.now();
      try {
        if (cancelled) throw new Error('RUN_CANCELLED_AFTER_TIMEOUT');
        p = await Promise.race([
          // Isolate mutable buffers/arrays between runs without passing labels.
          predict(structuredClone(input),{signal:controller.signal}),
          new Promise((_,reject) => { timer = setTimeout(() => { cancelled = true; controller.abort(); reject(new Error('TIMEOUT')); },timeoutMs); }),
        ]);
        validateChaosPrediction(p,input.roster);
      } catch (error) {
        // Never record arbitrary provider error text (may contain credentials).
        failure = ['TIMEOUT','RUN_CANCELLED_AFTER_TIMEOUT'].includes(error.message) ? error.message : 'ADAPTER_ERROR_OR_INVALID_TRACE';
        p = {status:'SYSTEM_FAIL',predicted_class:'UNKNOWN',result_class:null};
      } finally { clearTimeout(timer); }
      rows.push({id:c.id,scenario:c.scenario,truth:c.truth,expected_class:c.expected_class,
        split:c.split,catalog_id:c.catalog_id,category:c.category,source_group:c.source_group,
        roster_bucket:rosterBucket(c.roster.length),order,
        status:p.status,predicted_class:p.predicted_class,result_class:p.result_class,
        retrieved_keys:p.retrieved_keys,verified_keys:p.verified_keys,
        cost_usd:p.cost_usd,provider_calls:p.provider_calls,latency_ms:performance.now()-started,failure});
    }
  }
  return {mode:'chaotic_roster_frame_replay',manifest_sha256:createHash('sha256').update(manifestBytes).digest('hex'),
    adapter_sha256:createHash('sha256').update(adapterBytes).digest('hex'),
    ...assessChaos(manifest.cases,rows),rows};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifest,adapter,output] = process.argv.slice(2);
  if (!manifest || !adapter || !output) throw new Error('Usage: chaos-replay.mjs manifest.json adapter.mjs NEW-report.json');
  // Reserve the immutable output before inference, so a filename collision
  // cannot spend provider credits then fail to save the results.
  const { openSync, closeSync, unlinkSync } = await import('node:fs');
  const fd = openSync(output,'wx');
  try {
    const result = await replayChaos(resolve(manifest),resolve(adapter));
    writeFileSync(fd,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({metrics:result.metrics,gate:result.gate,coverage_gaps:result.coverage_gaps},null,2));
    if (!result.gate.passed) process.exitCode = 1;
  } catch (error) { unlinkSync(output); throw error; }
  finally { closeSync(fd); }
}
