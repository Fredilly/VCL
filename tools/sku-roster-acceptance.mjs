#!/usr/bin/env node
/**
 * SKU-roster acceptance gate for ANY creator/video/roster.
 * Input is a PRIVATE, reviewer-signed evaluation with independently identified
 * clicked objects, canonical SKU ids, return class, destination and latency.
 *
 * Never infer truth from title overlap, model similarity or API status.
 *
 * Example case:
 * { "id":"click-01", "reviewed_by":"reviewer", "truth":"IN_ROSTER",
 *   "true_sku":"sku-123", "result":{ "canonical_sku":"sku-123",
 *   "class":"SIMILAR", "destination":"https://merchant.example/item", "latency_ms":19000 } }
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function evaluateRosterAcceptance(manifest, { minReviewed = 20 } = {}) {
  if (!Array.isArray(manifest?.cases)) throw Error('cases array required');
  const seen = new Set();
  let reviewed = 0, correct = 0, wrong = 0, falseExact = 0, missing = 0, noDestination = 0;
  const latency = [], failures = [];
  const norm = v => String(v ?? '').trim();
  for (const item of manifest.cases) {
    if (!norm(item.id) || seen.has(item.id)) throw Error('missing or duplicate case ID');
    seen.add(item.id);
    // Human labels are a mandatory basis for all accuracy claims.
    if (!norm(item.reviewed_by) || !['IN_ROSTER','OUT_OF_ROSTER','AMBIGUOUS'].includes(item.truth)) continue;
    reviewed++;
    const result = item.result ?? {};
    const resultClass = norm(result.class).toUpperCase();
    const prediction = norm(result.canonical_sku);
    const expected = norm(item.true_sku);
    const isExact = resultClass === 'EXACT';
    const hasResult = Boolean(prediction || result.destination || resultClass && resultClass !== 'NONE');
    if (isExact && (item.truth !== 'IN_ROSTER' || !expected || !prediction || prediction !== expected)) falseExact++;
    if (item.truth === 'IN_ROSTER') {
      if (!expected) throw Error('reviewed IN_ROSTER case missing canonical SKU');
      if (!hasResult) missing++;
      else if (prediction === expected) correct++;
      else wrong++;
      if (hasResult && (!result.destination || !/^https:\/\/[^/]+/i.test(result.destination))) noDestination++;
    } else if (isExact) wrong++;
    if (Number.isFinite(result.latency_ms) && result.latency_ms >= 0) latency.push(result.latency_ms);
    if (isExact && (item.truth !== 'IN_ROSTER' || prediction !== expected)) failures.push({ id: item.id, reason: 'FALSE_EXACT' });
  }
  const scored = reviewed >= minReviewed;
  const ordered = latency.sort((a,b) => a-b);
  const p = q => ordered.length ? ordered[Math.min(ordered.length-1, Math.ceil(q*ordered.length)-1)] : null;
  return {
    total: manifest.cases.length, reviewed, min_reviewed: minReviewed,
    correct, wrong, missing, false_exact: falseExact, missing_destination: noDestination,
    useful_rate: reviewed ? correct/reviewed : null,
    latency_ms: { p50:p(.5), p95:p(.95) },
    status: !scored ? 'INSUFFICIENT_REVIEWED_CLICKS'
      : falseExact ? 'FAIL_FALSE_EXACT'
      : wrong || missing || noDestination ? 'MEASURED_WITH_PRODUCT_FAILURES'
      : 'PASS',
    note: 'Requires signed human-reviewed video clicks; catalog-photo controls, title overlap and model similarity are not ground truth.',
    failures,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const input = process.argv[2];
  if (!input) throw Error('Usage: node tools/sku-roster-acceptance.mjs private-reviewed-cases.json');
  const result = evaluateRosterAcceptance(JSON.parse(readFileSync(input,'utf8')));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}
