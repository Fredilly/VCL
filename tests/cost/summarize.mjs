import { readFile } from 'node:fs/promises';

const runPath = process.argv[2] ?? 'tests/cost/run.json';
const pricingPath = process.argv[3] ?? 'tests/cost/pricing-2026-09-16.json';

const [run, pricing] = await Promise.all([
  readFile(runPath, 'utf8').then(JSON.parse),
  readFile(pricingPath, 'utf8').then(JSON.parse),
]);

function tokenCost(usage) {
  if (!usage) return 0;
  const key = `${usage.provider}:${usage.model}`;
  const rate = pricing.token_models?.[key];
  if (!rate) return 0;
  return ((usage.prompt_tokens ?? 0) / 1_000_000) * rate.input_per_million_usd
    + ((usage.completion_tokens ?? 0) / 1_000_000) * rate.output_per_million_usd;
}

function requestCost(calls = {}) {
  return Object.entries(calls).reduce((sum, [provider, count]) => {
    const rate = pricing.request_providers?.[provider]?.per_request_usd ?? 0;
    return sum + Number(count || 0) * rate;
  }, 0);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

const rows = (run.runs ?? []).map((entry) => {
  const localization = tokenCost(entry.localization_usage);
  const vision = tokenCost(entry.vision_usage);
  const verification = tokenCost(entry.verification_usage);
  const commerce = requestCost(entry.commerce_calls);
  const total = localization + vision + verification + commerce;
  return {
    id: entry.case_id ?? entry.id ?? 'unknown',
    localization_usd: localization,
    vision_usd: vision,
    verification_usd: verification,
    commerce_usd: commerce,
    total_usd: total,
    latency_ms: Number(entry.latency_ms ?? 0),
  };
});

if (!rows.length) {
  console.error(`No runs found in ${runPath}`);
  process.exit(1);
}

const costs = rows.map((row) => row.total_usd);
const latencies = rows.map((row) => row.latency_ms).filter((value) => value > 0);
const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
const median = percentile(costs, 50);
const stages = {
  localization: rows.reduce((sum, row) => sum + row.localization_usd, 0),
  vision: rows.reduce((sum, row) => sum + row.vision_usd, 0),
  verification: rows.reduce((sum, row) => sum + row.verification_usd, 0),
  commerce: rows.reduce((sum, row) => sum + row.commerce_usd, 0),
};
const dominant = Object.entries(stages).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

const summary = {
  pricing_snapshot_date: pricing.snapshot_date,
  sample_size: rows.length,
  mean_cost_usd: mean,
  median_cost_usd: median,
  p50_latency_ms: percentile(latencies, 50),
  p95_latency_ms: percentile(latencies, 95),
  projected_100_usd: mean * 100,
  projected_1000_usd: mean * 1000,
  projected_10000_usd: mean * 10000,
  dominant_cost_stage: dominant,
  stage_totals_usd: stages,
};

console.log(JSON.stringify({ rows, summary }, null, 2));
