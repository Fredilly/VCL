import { createHash } from 'node:crypto';
import { summarize, gate } from './metrics.mjs';

// Versioned engineering acceptance policy, never adapter-supplied thresholds.
export const chaosPolicy = Object.freeze({
  version: 1, minCatalogs: 3, minCategories: 3, minSourcesPerCatalog: 2,
  minPositivePerSlice: 5, minNegativePerSlice: 5, minAmbiguousPerSlice: 2,
  minExactObservations: 60, accuracy: .95, recallAt5: .95,
});
export const chaosScenarios = [
  'clean', 'family_lookalike', 'variant_visible', 'variant_unobservable',
  'mixed_categories', 'multiple_objects', 'misleading_text', 'wrong_roster',
  'missing_reference', 'duplicate_offers', 'stale_memory', 'scene_cut',
  'occluded', 'out_of_roster',
];
export const rosterBucket = n => n === 0 ? 'empty' : n === 1 ? 'single' : n <= 16 ? '2-16' : n <= 64 ? '17-64' : '65+';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rate = (n, d) => d ? n / d : null;
const percentile = (values, q) => values.length ? [...values].sort((a,b) => a-b)[Math.ceil(values.length*q)-1] : null;

export function validateChaosManifest(manifest) {
  if (manifest.version !== 2 || !manifest.cases?.length) throw new Error('Empty/unsupported chaos manifest');
  if (new Set(manifest.cases.map(c => c.id)).size !== manifest.cases.length) throw new Error('Duplicate case IDs');
  const frameSplits = new Map();
  const observations = new Set();
  const sourceSplits = new Map();
  const catalogSplits = new Map();
  for (const c of manifest.cases) {
    if (!c.id || !chaosScenarios.includes(c.scenario)) throw new Error('Invalid chaos ID/scenario');
    if (!['IN_ROSTER','OUT_OF_ROSTER','AMBIGUOUS'].includes(c.truth)) throw new Error(`${c.id}: invalid truth`);
    if (!Array.isArray(c.roster)) throw new Error(`${c.id}: roster required (may be empty)`);
    const keys = c.roster.map(r => r.canonical_key);
    if (keys.some(k => typeof k !== 'string' || !k || ['NONE','UNKNOWN'].includes(k)) || new Set(keys).size !== keys.length) throw new Error(`${c.id}: unique canonical SKU keys required; group duplicate offers under one SKU`);
    if (c.truth === 'IN_ROSTER' ? !keys.includes(c.expected_class) : c.expected_class !== 'NONE') throw new Error(`${c.id}: invalid truth identity`);
    for (const field of ['catalog_id','source_group','category','reviewed_by']) if (typeof c[field] !== 'string' || !c[field].trim()) throw new Error(`${c.id}: ${field} required`);
    if (!['development','holdout'].includes(c.split)) throw new Error(`${c.id}: split required`);
    if (!c.input?.frames?.length || !c.input.click || !['x','y'].every(k => Number.isFinite(c.input.click[k]) && c.input.click[k] >= 0 && c.input.click[k] <= 1)) throw new Error(`${c.id}: frames and normalized click required`);
    for (const f of c.input.frames) if (!f.path || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isFinite(f.timestamp_ms) || f.timestamp_ms < 0) throw new Error(`${c.id}: frozen frame required`);
    const observation = hash({frames:c.input.frames.map(f => f.sha256),click:c.input.click});
    if (observations.has(observation)) throw new Error(`${c.id}: duplicate observation; use perturbations rather than inflating sample size`);
    observations.add(observation);
    for (const [map, key] of [[sourceSplits,c.source_group], [catalogSplits,c.catalog_id], ...c.input.frames.map(f => [frameSplits,f.sha256])]) {
      if (map.has(key) && map.get(key) !== c.split) throw new Error(`${c.id}: development/holdout leakage`);
      map.set(key,c.split);
    }
    for (const item of c.roster) {
      if (typeof item.title !== 'string' || !item.title.trim()) throw new Error(`${c.id}: catalog title required`);
      if (!Array.isArray(item.references)) throw new Error(`${c.id}: references required; [] explicitly means missing imagery`);
      for (const f of item.references) if (!f.path || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error(`${c.id}: frozen reference/hash required`);
    }
  }
}

// Explicit allowlist: labels, file paths, review metadata and arbitrary catalog
// fields never enter the adapter. Freeze reference bytes before any paid call.
export function chaosInput(c, load) {
  return {
    frames: c.input.frames.map(f => ({ timestamp_ms: f.timestamp_ms, bytes: load(f) })),
    click: { x: c.input.click.x, y: c.input.click.y },
    context: Object.fromEntries(['video_title','visible_text','spoken_text'].filter(k => typeof c.input.context?.[k] === 'string').map(k => [k,c.input.context[k]])),
    roster: c.roster.map(r => ({ canonical_key: r.canonical_key, title: r.title,
      attributes: Object.fromEntries(['brand','model','sku','color','size','material'].filter(k => typeof r.attributes?.[k] === 'string').map(k => [k,r.attributes[k]])),
      offers: (Array.isArray(r.offers) ? r.offers : []).map(o => ({merchant: String(o.merchant ?? ''),title: String(o.title ?? '')})),
      references: r.references.map(f => ({ bytes: load(f) })) })),
    answer_space: [...c.roster.map(r => r.canonical_key),'NONE','UNKNOWN'],
  };
}

export function orderVariants(input) {
  const base = input.roster;
  const orders = [base, [...base].reverse(), [...base.slice(1), ...base.slice(0,1)]];
  const seen = new Set();
  return orders.filter(roster => { const key = hash(roster.map(r => r.canonical_key)); if (seen.has(key)) return false; seen.add(key); return true; })
    .map(roster => ({ ...input, roster, answer_space: [...roster.map(r => r.canonical_key),'NONE','UNKNOWN'] }));
}

export function validateChaosPrediction(p, roster) {
  if (!p || !['OK','PROVIDER_BLOCKED','SYSTEM_FAIL'].includes(p.status)) throw new Error('Invalid prediction status');
  if (p.status !== 'OK') return;
  const keys = roster.map(r => r.canonical_key);
  if (!['NONE','UNKNOWN',...keys].includes(p.predicted_class)) throw new Error('Invalid identity');
  if (!['EXACT','SIMILAR','RELATED',null].includes(p.result_class)) throw new Error('Invalid result class');
  if (['NONE','UNKNOWN'].includes(p.predicted_class) ? p.result_class !== null : p.result_class === null) throw new Error('Identity/result mismatch');
  // These are actual pre-verification candidates, in retrieval order. No scores
  // or ground truth are supplied by the harness to the adapter.
  if (!Array.isArray(p.retrieved_keys) || new Set(p.retrieved_keys).size !== p.retrieved_keys.length || p.retrieved_keys.some(k => !keys.includes(k))) throw new Error('Invalid retrieval trace');
  if (!Array.isArray(p.verified_keys) || new Set(p.verified_keys).size !== p.verified_keys.length || p.verified_keys.some(k => !p.retrieved_keys.includes(k))) throw new Error('Invalid verification trace');
  if (keys.includes(p.predicted_class) && !p.retrieved_keys.includes(p.predicted_class)) throw new Error('Identity absent from retrieval');
  if (p.result_class === 'EXACT' && !p.verified_keys.includes(p.predicted_class)) throw new Error('Exact bypassed verification');
  for (const field of ['cost_usd','provider_calls']) if (!Number.isFinite(p[field]) || p[field] < 0) throw new Error(`Missing/invalid ${field}`);
  if (!Number.isInteger(p.provider_calls)) throw new Error('Invalid provider call count');
}

export function stageMetrics(rows) {
  const base = summarize(rows);
  const positives = rows.filter(r => r.truth === 'IN_ROSTER');
  const exact = rows.filter(r => r.status === 'OK' && r.result_class === 'EXACT');
  const rank = r => r.status === 'OK' ? (r.retrieved_keys ?? []).indexOf(r.expected_class) : -1;
  return { ...base,
    recall_at_1: rate(positives.filter(r => rank(r) === 0).length, positives.length),
    recall_at_5: rate(positives.filter(r => rank(r) >= 0 && rank(r) < 5).length, positives.length),
    reciprocal_rank: rate(positives.reduce((n,r) => n + (rank(r) < 0 ? 0 : 1/(rank(r)+1)),0), positives.length),
    exact_precision: rate(exact.length-base.false_exact,exact.length),
    exact_observations: exact.length,
    // One-sided binomial bound under independent trials; correlated frames do
    // not establish this production guarantee. Perturbations are excluded.
    zero_error_upper_95: base.false_exact === 0 && exact.length ? 1-Math.pow(.05,1/exact.length) : null,
    retrieval_misses: positives.filter(r => rank(r) < 0).map(r => r.id),
    verification_or_ranking_misses: positives.filter(r => rank(r) >= 0 && r.predicted_class !== r.expected_class).map(r => r.id),
    latency_ms: { p50: percentile(rows.map(r => r.latency_ms).filter(Number.isFinite),.5), p95: percentile(rows.map(r => r.latency_ms).filter(Number.isFinite),.95) },
    provider_calls: rows.every(r => Number.isFinite(r.provider_calls)) ? rows.reduce((n,r) => n+r.provider_calls,0) : null,
    cost_usd: rows.every(r => Number.isFinite(r.cost_usd)) ? rows.reduce((n,r) => n+r.cost_usd,0) : null,
  };
}

export function assessChaos(cases, rows) {
  // Repeated input permutations do not inflate sample size or accuracy.
  const base = rows.filter(r => r.order === 0 && r.split === 'holdout');
  const metrics = stageMetrics(base);
  const failures = new Set(gate(metrics, {top1:.95,noneRecall:.95,ambiguity:1}).failures);
  const coverage = [];
  const slices = {};
  const heldout = cases.filter(c => c.split === 'holdout');
  const checkSlice = (name, subset) => {
    const m = stageMetrics(subset); slices[name] = m;
    for (const [truth, min] of [['IN_ROSTER',chaosPolicy.minPositivePerSlice],['OUT_OF_ROSTER',chaosPolicy.minNegativePerSlice],['AMBIGUOUS',chaosPolicy.minAmbiguousPerSlice]]) {
      if (subset.filter(r => r.truth === truth).length < min) coverage.push(`${name}:${truth}`);
    }
    // Never let easy negatives hide a failed SKU retrieval category/catalog.
    if (m.in_roster_accuracy !== null && m.in_roster_accuracy < chaosPolicy.accuracy) failures.add(`SLICE_ACCURACY:${name}`);
    if (m.none_recall !== null && m.none_recall < .95) failures.add(`SLICE_NONE:${name}`);
    if (m.ambiguity_abstention !== null && m.ambiguity_abstention < 1) failures.add(`SLICE_AMBIGUITY:${name}`);
    if (m.recall_at_5 !== null && m.recall_at_5 < chaosPolicy.recallAt5) failures.add(`SLICE_RETRIEVAL:${name}`);
  };
  for (const field of ['catalog_id','category']) for (const v of new Set(heldout.map(c => c[field]))) checkSlice(`${field}:${v}`,base.filter(r => r[field] === v));
  for (const bucket of ['single','2-16','17-64','65+']) checkSlice(`roster_size:${bucket}`,base.filter(r => r.roster_bucket === bucket));
  for (const scenario of chaosScenarios) {
    const subset = base.filter(r => r.scenario === scenario);
    if (!subset.length) coverage.push(`scenario:${scenario}`);
    else {
      const bad = subset.some(r => r.status !== 'OK' || (r.truth === 'AMBIGUOUS' ? !['NONE','UNKNOWN'].includes(r.predicted_class) : r.predicted_class !== r.expected_class));
      if (bad) failures.add(`SCENARIO_FAILURE:${scenario}`);
    }
  }
  if (!base.some(r => r.roster_bucket === 'empty' && r.truth === 'OUT_OF_ROSTER' && r.predicted_class === 'NONE')) coverage.push('empty_roster');
  for (const [field,min] of [['catalog_id',chaosPolicy.minCatalogs],['category',chaosPolicy.minCategories]]) if (new Set(heldout.map(c => c[field])).size < min) coverage.push(field);
  for (const catalog of new Set(heldout.map(c => c.catalog_id))) if (new Set(heldout.filter(c => c.catalog_id === catalog).map(c => c.source_group)).size < chaosPolicy.minSourcesPerCatalog) coverage.push(`sources:${catalog}`);
  if (metrics.exact_observations < chaosPolicy.minExactObservations) coverage.push('exact_observations');
  if (metrics.recall_at_5 === null || metrics.recall_at_5 < chaosPolicy.recallAt5) failures.add('RETRIEVAL_RECALL_AT_5');
  const unstable = [];
  for (const c of cases) {
    const variants = rows.filter(r => r.id === c.id);
    if (new Set(variants.map(r => JSON.stringify([r.status,r.predicted_class,r.result_class]))).size > 1) unstable.push(c.id);
  }
  if (unstable.length) failures.add('ROSTER_ORDER_INSTABILITY');
  // Trust failures in development and in any permutation still block promotion.
  const all = summarize(rows);
  const allStages = stageMetrics(rows);
  if (allStages.recall_at_5 === null || allStages.recall_at_5 < chaosPolicy.recallAt5) failures.add('ALL_ORDERS_RETRIEVAL_RECALL_AT_5');
  if (all.false_exact) failures.add('FALSE_EXACT');
  if (all.provider_blocked) failures.add('PROVIDER_BLOCKED');
  if (all.system_failures) failures.add('SYSTEM_FAIL');
  if (coverage.length) failures.add('INSUFFICIENT_COVERAGE');
  return { policy: chaosPolicy, metrics, slices, coverage_gaps: coverage, unstable_case_ids: unstable,
    all_orders_false_exact_ids: all.false_exact_ids,
    run_totals: { attempts: rows.length, cost_usd: allStages.cost_usd, provider_calls: allStages.provider_calls, latency_ms: allStages.latency_ms },
    gate: { passed: !failures.size, failures: [...failures] } };
}
