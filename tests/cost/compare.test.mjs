import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { compare, compactSummary, formatReport, extractMetrics, THRESHOLDS } from './compare.mjs';

const pricing = JSON.parse(await readFile('tests/cost/pricing-2026-09-16.json', 'utf8'));

// ── fixture builders ────────────────────────────────────────────────
function makeRun(runs, summaryOverrides = {}) {
  return {
    schema_version: 1,
    spike: '7',
    run_date: '2026-09-17T00:00:00.000Z',
    pricing_snapshot_date: '2026-09-16',
    runs,
    failed_runs: [],
    summary: { sample_size: runs.length, attempted: runs.length, failed: 0, ...summaryOverrides },
  };
}

function makeCase(id, opts = {}) {
  return {
    case_id: id,
    selected_item: `item ${id}`,
    failed: false,
    localization_usage: null,
    vision_usage: null,
    analysis: { category: 'Test', subcategory: 'Item', brand: null, model: null, color: 'black' },
    commerce_query: { query: 'test' },
    verification_usage: {
      provider: 'gemini', model: 'gemini-3.5-flash-lite',
      requests: opts.requests ?? 3, prompt_tokens: opts.prompt_tokens ?? 20000,
      completion_tokens: opts.completion_tokens ?? 6000, total_tokens: opts.total_tokens ?? 26000,
    },
    verification: {
      retrieved: opts.retrieved ?? 20, compared: opts.compared ?? 15,
      image_failures: opts.image_failures ?? 2,
      image_failure_reasons: opts.image_failure_reasons ?? { image_missing: opts.image_failures ?? 2 },
      rejected: opts.rejected ?? 10, contradictions: {},
    },
    commerce_calls: opts.commerce_calls ?? { ebay: 2, etsy: 2 },
    latency_ms: opts.latency_ms ?? 50000,
    provider_blocked: false,
    providers_used: ['ebay', 'etsy'],
    notes: opts.notes ?? 'state=RESULTS; products=5',
  };
}

function baseline10() {
  return makeRun([
    makeCase('s5-01', { latency_ms: 98729, requests: 5, prompt_tokens: 28682, completion_tokens: 9143, retrieved: 41, compared: 17, image_failures: 24, image_failure_reasons: { image_missing: 24 }, rejected: 40, commerce_calls: { ebay: 3, etsy: 3, brave: 3, serpapi: 1 }, notes: 'state=RESULTS; products=1' }),
    makeCase('s5-02', { latency_ms: 31923, requests: 2, prompt_tokens: 12716, completion_tokens: 4199, retrieved: 19, compared: 8, image_failures: 11, image_failure_reasons: { image_missing: 11 }, rejected: 12, commerce_calls: { ebay: 2, etsy: 3 }, notes: 'state=RESULTS; products=7' }),
    makeCase('s5-03', { latency_ms: 76904, requests: 5, prompt_tokens: 32409, completion_tokens: 10614, retrieved: 20, compared: 20, image_failures: 0, image_failure_reasons: {}, rejected: 9, commerce_calls: { ebay: 3, etsy: 3 }, notes: 'state=RESULTS; products=8' }),
    makeCase('s5-04', { latency_ms: 53248, requests: 5, prompt_tokens: 33536, completion_tokens: 11493, retrieved: 21, compared: 21, image_failures: 0, image_failure_reasons: {}, rejected: 10, commerce_calls: { ebay: 3, etsy: 3 }, notes: 'state=RESULTS; products=8' }),
    makeCase('s5-05', { latency_ms: 89649, requests: 4, prompt_tokens: 25539, completion_tokens: 8543, retrieved: 24, compared: 16, image_failures: 8, image_failure_reasons: { image_missing: 8 }, rejected: 12, commerce_calls: { ebay: 3, etsy: 3, brave: 1 }, notes: 'state=RESULTS; products=8' }),
    makeCase('s5-06', { latency_ms: 60936, requests: 5, prompt_tokens: 31785, completion_tokens: 9959, retrieved: 44, compared: 2, image_failures: 42, image_failure_reasons: { model_schema: 18, image_missing: 24 }, rejected: 44, commerce_calls: { ebay: 3, etsy: 3, brave: 3, serpapi: 1 }, notes: 'state=NO_RESULTS; products=0' }),
    makeCase('s5-07', { latency_ms: 116882, requests: 6, prompt_tokens: 38457, completion_tokens: 12687, retrieved: 24, compared: 24, image_failures: 0, image_failure_reasons: {}, rejected: 14, commerce_calls: { ebay: 3, etsy: 3 }, notes: 'state=RESULTS; products=8' }),
    makeCase('s5-08', { latency_ms: 37309, requests: 2, prompt_tokens: 12749, completion_tokens: 3978, retrieved: 24, compared: 8, image_failures: 16, image_failure_reasons: { image_missing: 16 }, rejected: 24, commerce_calls: { ebay: 2, brave: 2, serpapi: 1 }, notes: 'state=NO_RESULTS; products=0' }),
    makeCase('s5-09', { latency_ms: 61538, requests: 2, prompt_tokens: 12746, completion_tokens: 4040, retrieved: 24, compared: 8, image_failures: 16, image_failure_reasons: { image_missing: 16 }, rejected: 24, commerce_calls: { ebay: 2, brave: 2, serpapi: 1 }, notes: 'state=NO_RESULTS; products=0' }),
    makeCase('s5-10', { latency_ms: 50137, requests: 5, prompt_tokens: 30466, completion_tokens: 10118, retrieved: 27, compared: 19, image_failures: 8, image_failure_reasons: { image_missing: 8 }, rejected: 17, commerce_calls: { ebay: 3, etsy: 3, brave: 1 }, notes: 'state=RESULTS; products=8' }),
  ]);
}

// ── tests ──────────────────────────────────────────────────────────

test('identical run returns PASS with zero deltas', () => {
  const base = baseline10();
  const diff = compare(base, base, pricing);
  assert.equal(diff.overall, 'PASS');
  assert.equal(diff.quality.useful_rate.delta_pct, 0);
  assert.equal(diff.latency.p50.delta_pct, 0);
  assert.equal(diff.cost.mean.delta_pct, 0);
  assert.equal(diff.cost.median.delta_pct, 0);
});

test('clear improvement returns PASS', () => {
  const base = baseline10();
  const improved = makeRun(base.runs.map((r) => ({
    ...r,
    latency_ms: Math.round(r.latency_ms * 0.7),
    verification_usage: { ...r.verification_usage, prompt_tokens: Math.round(r.verification_usage.prompt_tokens * 0.8) },
  })));
  const diff = compare(base, improved, pricing);
  assert.equal(diff.overall, 'PASS');
  assert.ok(diff.cost.mean.delta < 0, 'cost should decrease');
  assert.ok(diff.latency.p50.delta < 0, 'latency should decrease');
});

test('latency regression beyond threshold returns FAIL', () => {
  const base = baseline10();
  const slow = makeRun(base.runs.map((r) => ({
    ...r,
    latency_ms: Math.round(r.latency_ms * 2.5),
  })));
  const diff = compare(base, slow, pricing);
  assert.equal(diff.overall, 'FAIL');
  assert.equal(diff.latency.p50.status, 'FAIL');
  assert.equal(diff.latency.p95.status, 'FAIL');
});

test('latency regression within threshold returns WARN', () => {
  const base = baseline10();
  const slow = makeRun(base.runs.map((r) => ({
    ...r,
    latency_ms: Math.round(r.latency_ms * 1.15),
  })));
  const diff = compare(base, slow, pricing);
  assert.equal(diff.latency.p50.status, 'WARN');
  assert.equal(diff.latency.p95.status, 'WARN');
});

test('cost regression beyond threshold returns FAIL', () => {
  const base = baseline10();
  const expensive = makeRun(base.runs.map((r) => ({
    ...r,
    verification_usage: { ...r.verification_usage, prompt_tokens: Math.round(r.verification_usage.prompt_tokens * 3) },
  })));
  const diff = compare(base, expensive, pricing);
  assert.equal(diff.overall, 'FAIL');
  assert.equal(diff.cost.mean.status, 'FAIL');
});

test('cost regression within threshold returns WARN', () => {
  const base = baseline10();
  const expensive = makeRun(base.runs.map((r) => ({
    ...r,
    verification_usage: { ...r.verification_usage, prompt_tokens: Math.round(r.verification_usage.prompt_tokens * 1.15) },
  })));
  const diff = compare(base, expensive, pricing);
  assert.equal(diff.cost.mean.status, 'WARN');
});

test('useful-result quality regression returns FAIL', () => {
  const base = baseline10();
  const worse = makeRun(base.runs.map((r, i) => ({
    ...r,
    notes: i < 3 ? 'state=NO_RESULTS; products=0' : r.notes,
  })));
  const diff = compare(base, worse, pricing);
  assert.equal(diff.overall, 'FAIL');
  assert.equal(diff.quality.useful_rate.status, 'FAIL');
  assert.ok(diff.quality.useful_rate.delta < 0, 'useful rate should decrease');
});

test('missing usage in candidate returns null cost, not $0', () => {
  const base = baseline10();
  const candidate = makeRun(base.runs.map((r) => ({
    ...r,
    verification_usage: null,
    commerce_calls: {},
  })));
  const diff = compare(base, candidate, pricing);
  assert.equal(diff.overall, 'PASS');
  // candidate costs are null, baseline costs are real — metric is unavailable
  assert.equal(diff.cost.mean.candidate, null);
  assert.equal(diff.cost.mean.delta, null);
  assert.equal(diff.cost.mean.status, 'PASS');
  assert.equal(diff.quality.cost_per_useful.candidate, null);
  assert.equal(diff.quality.cost_per_useful.status, 'PASS');
});

test('missing optional metric returns PASS (not FAIL)', () => {
  const sparseBoth = makeRun(baseline10().runs.map((r) => ({
    ...r,
    verification_usage: null,
    commerce_calls: {},
  })));
  const diff = compare(sparseBoth, sparseBoth, pricing);
  assert.equal(diff.overall, 'PASS');
  assert.equal(diff.cost.mean.status, 'PASS');
  assert.equal(diff.cost.mean.delta_pct, null);
});

test('compactSummary produces one-liner', () => {
  const base = baseline10();
  const diff = compare(base, base, pricing);
  const line = compactSummary(diff);
  assert.ok(line.includes('cost'), 'should mention cost');
  assert.ok(line.includes('p50'), 'should mention p50');
  assert.ok(line.includes('p95'), 'should mention p95');
  assert.ok(line.includes('useful'), 'should mention useful');
});

test('formatReport produces structured output', () => {
  const base = baseline10();
  const diff = compare(base, base, pricing);
  const report = formatReport(diff);
  assert.ok(report.includes('OVERALL'), 'should have OVERALL section');
  assert.ok(report.includes('QUALITY'), 'should have QUALITY section');
  assert.ok(report.includes('LATENCY'), 'should have LATENCY section');
  assert.ok(report.includes('COST'), 'should have COST section');
  assert.ok(report.includes('PASS'), 'should indicate PASS');
});

test('extractMetrics computes costs from raw runs', () => {
  const base = baseline10();
  const m = extractMetrics(base, pricing);
  assert.equal(m.sample_size, 10);
  assert.equal(m.useful, 7);
  assert.equal(m.useful_rate, 0.7);
  assert.ok(m.mean_cost > 0, 'should have positive mean cost');
  assert.ok(m.median_cost > 0, 'should have positive median cost');
  assert.ok(m.p50_latency > 0, 'should have p50 latency');
  assert.ok(m.p95_latency > 0, 'should have p95 latency');
});

test('cost_per_useful is total cost / useful results', () => {
  const base = baseline10();
  const m = extractMetrics(base, pricing);
  // total cost = sum of all 10 case costs; useful = 7
  // cost_per_useful should be ~$0.0643, not ~$0.0064
  assert.ok(m.cost_per_useful > 0.05, 'cost_per_useful should be > $0.05');
  assert.ok(m.cost_per_useful < 0.08, 'cost_per_useful should be < $0.08');
  const totalCost = m.mean_cost * m.sample_size;
  const expected = totalCost / m.useful;
  assert.ok(Math.abs(m.cost_per_useful - expected) < 0.0001, 'cost_per_useful should equal totalCost / useful');
});

test('image_missing_rate counts only image_missing, not model_schema', () => {
  const run = makeRun([
    makeCase('a', { retrieved: 100, image_failures: 20, image_failure_reasons: { image_missing: 10, model_schema: 10 }, notes: 'state=RESULTS; products=5' }),
  ]);
  const m = extractMetrics(run, pricing);
  // 10 image_missing out of 100 retrieved = 0.10
  assert.equal(m.image_missing_rate, 0.10);
});

test('image_missing_rate FAIL on pp delta exceeds threshold', () => {
  const base = makeRun([
    makeCase('a', { retrieved: 100, image_failures: 5, image_failure_reasons: { image_missing: 5 }, notes: 'state=RESULTS; products=5' }),
  ]);
  // candidate: 11pp increase (5% → 16%) exceeds 10pp threshold
  const candidate = makeRun([
    makeCase('a', { retrieved: 100, image_failures: 16, image_failure_reasons: { image_missing: 16 }, notes: 'state=RESULTS; products=5' }),
  ]);
  const diff = compare(base, candidate, pricing);
  assert.equal(diff.quality.image_missing_rate.status, 'FAIL');
});

test('rejection_rate FAIL on pp delta exceeds threshold', () => {
  const base = makeRun([
    makeCase('a', { retrieved: 100, rejected: 20, notes: 'state=RESULTS; products=5' }),
  ]);
  // candidate: 15pp increase (20% → 35%) exceeds 10pp threshold
  const candidate = makeRun([
    makeCase('a', { retrieved: 100, rejected: 35, notes: 'state=RESULTS; products=5' }),
  ]);
  const diff = compare(base, candidate, pricing);
  assert.equal(diff.quality.rejection_rate.status, 'FAIL');
});

test('thresholds are documented and reasonable', () => {
  assert.equal(THRESHOLDS.useful_rate_drop_pp, 5);
  assert.equal(THRESHOLDS.latency_increase_pct, 20);
  assert.equal(THRESHOLDS.cost_increase_pct, 20);
  assert.equal(THRESHOLDS.rate_increase_pp, 10);
});
