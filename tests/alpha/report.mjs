import { readFile } from 'node:fs/promises';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node tests/alpha/report.mjs <cloudflare-jsonl-log> [pricing.json]');
  process.exit(1);
}

const pricingPath = process.argv[3] ?? 'tests/cost/pricing-2026-09-16.json';
const [text, pricing] = await Promise.all([
  readFile(inputPath, 'utf8'),
  readFile(pricingPath, 'utf8').then(JSON.parse).catch(() => ({ token_models: {}, request_providers: {} })),
]);

const rows = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap(line => {
  const start = line.indexOf('{');
  if (start < 0) return [];
  try { return [JSON.parse(line.slice(start))]; } catch { return []; }
});
const scoops = rows.filter(r => r.event === 'ALPHA_SCOOP');
const feedback = rows.filter(r => r.event === 'ALPHA_FEEDBACK');

const pct = (n, d) => d ? n / d : null;
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};
const tokenCost = usage => {
  if (!usage) return 0;
  const rate = pricing.token_models?.[`${usage.provider}:${usage.model}`];
  if (!rate) return Number(usage.cost_usd ?? 0);
  return ((Number(usage.prompt_tokens ?? 0) / 1_000_000) * Number(rate.input_per_million_usd ?? 0))
    + ((Number(usage.completion_tokens ?? 0) / 1_000_000) * Number(rate.output_per_million_usd ?? 0));
};
const requestCost = calls => Object.entries(calls ?? {}).reduce((sum,[provider,count]) =>
  sum + Number(count ?? 0) * Number(pricing.request_providers?.[provider]?.per_request_usd ?? 0), 0);

const scoopById = new Map(scoops.map(s => [s.event_id, s]));
const resultClass = new Map();
for (const scoop of scoops) for (const row of scoop.results ?? []) resultClass.set(`${scoop.event_id}:${row.id}`, row.result_class);

let useful = 0;
let negative = 0;
let falseExact = 0;
let unsupportedLikely = 0;
for (const row of feedback) {
  if (row.feedback_type === 'useful' || row.feedback_type === 'correct_match') useful++;
  if (['wrong_item','wrong_category','not_similar'].includes(row.feedback_type)) {
    negative++;
    const klass = resultClass.get(`${row.event_id}:${row.result_id}`);
    if (klass === 'EXACT') falseExact++;
    if (klass === 'LIKELY') unsupportedLikely++;
  }
}

const costs = scoops.map(s => tokenCost(s.vision_usage) + tokenCost(s.verification_usage) + requestCost(s.commerce_calls));
const usefulEventIds = new Set(feedback.filter(f => ['useful','correct_match'].includes(f.feedback_type)).map(f => f.event_id));
const usefulCosts = scoops.filter(s => usefulEventIds.has(s.event_id)).map(s => tokenCost(s.vision_usage) + tokenCost(s.verification_usage) + requestCost(s.commerce_calls));
const sessions = new Map();
for (const s of scoops) sessions.set(s.session_id, (sessions.get(s.session_id) ?? 0) + 1);

const summary = {
  sample_size: scoops.length,
  result_rate_proxy: pct(scoops.filter(s => s.state === 'RESULTS').length, scoops.length),
  no_result_rate: pct(scoops.filter(s => s.state === 'NO_RESULTS').length, scoops.length),
  provider_failure_rate: pct(scoops.filter(s => s.state === 'TEMPORARILY_UNAVAILABLE').length, scoops.length),
  useful_rate_feedback: pct(useful, useful + negative),
  feedback_false_exact_count: falseExact,
  feedback_unsupported_likely_count: unsupportedLikely,
  p50_latency_ms: percentile(scoops.map(s => Number(s.latency_ms)).filter(Number.isFinite), 50),
  p95_latency_ms: percentile(scoops.map(s => Number(s.latency_ms)).filter(Number.isFinite), 95),
  mean_cost_per_scoop_usd: costs.length ? costs.reduce((a,b)=>a+b,0)/costs.length : null,
  mean_cost_per_feedback_useful_scoop_usd: usefulCosts.length ? usefulCosts.reduce((a,b)=>a+b,0)/usefulCosts.length : null,
  sessions: sessions.size,
  repeat_session_rate: pct([...sessions.values()].filter(n => n > 1).length, sessions.size),
  feedback_counts: Object.fromEntries([...new Set(feedback.map(f=>f.feedback_type))].sort().map(type => [type, feedback.filter(f=>f.feedback_type===type).length])),
  notes: [
    'result_rate_proxy is not the same as user-confirmed usefulness.',
    'false EXACT / unsupported LIKELY are counted only when negative feedback exists for that specific result.',
    'session_id is ephemeral per page/content-script lifetime; repeat_session_rate measures repeated Scoops within that session, not cross-day identity.',
    'cost uses only providers present in the pricing snapshot; unknown provider prices contribute 0 until pricing is added.'
  ],
};

console.log(JSON.stringify(summary, null, 2));
