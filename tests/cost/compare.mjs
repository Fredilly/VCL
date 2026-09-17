import { readFile } from 'node:fs/promises';

/**
 * Spike 7 benchmark regression comparator.
 *
 * Compares a candidate cost run against a frozen baseline and reports
 * per-metric deltas with PASS / WARN / FAIL statuses.
 *
 * Thresholds (conservative, easy to adjust later):
 *   quality  — useful-result rate must not drop more than 5 pp
 *   latency — p50 and p95 must not increase more than 20 %
 *   cost    — mean and median must not increase more than 20 %
 *
 * Any FAIL in quality is an immediate FAIL overall.
 */

// ── thresholds ──────────────────────────────────────────────────────
export const THRESHOLDS = {
  useful_rate_drop_pp: 5,
  latency_increase_pct: 20,
  cost_increase_pct: 20,
  rate_increase_pp: 10,
};

// ── helpers ─────────────────────────────────────────────────────────
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function pctDelta(baseline, candidate) {
  if (baseline === 0) return candidate === 0 ? 0 : Infinity;
  return ((candidate - baseline) / Math.abs(baseline)) * 100;
}

function tokenCost(usage, pricing) {
  if (!usage) return null;
  const key = `${usage.provider}:${usage.model}`;
  const rate = pricing.token_models?.[key];
  if (!rate) return null;
  return ((usage.prompt_tokens ?? 0) / 1_000_000) * rate.input_per_million_usd
    + ((usage.completion_tokens ?? 0) / 1_000_000) * rate.output_per_million_usd;
}

function requestCost(calls = {}, pricing) {
  return Object.entries(calls).reduce((sum, [provider, count]) => {
    const rate = pricing.request_providers?.[provider]?.per_request_usd ?? 0;
    return sum + Number(count || 0) * rate;
  }, 0);
}

function computeRunCosts(run, pricing) {
  const runs = run.runs ?? [];
  return runs.map((entry) => {
    const verification = tokenCost(entry.verification_usage, pricing);
    const commerce = requestCost(entry.commerce_calls, pricing);
    // If any component is null (missing usage), the total is unavailable
    if (verification === null) {
      return {
        id: entry.case_id ?? entry.id ?? 'unknown',
        total_usd: null,
        verification_usd: null,
        commerce_usd: commerce,
      };
    }
    return {
      id: entry.case_id ?? entry.id ?? 'unknown',
      total_usd: verification + commerce,
      verification_usd: verification,
      commerce_usd: commerce,
    };
  });
}

// ── extract metrics from a run.json + pricing ──────────────────────
export function extractMetrics(run, pricing) {
  const runs = run.runs ?? [];
  const latencies = runs.map((r) => r.latency_ms).filter((v) => v > 0);
  const verification = runs.map((r) => r.verification);
  const notes = runs.map((r) => r.notes ?? '');

  // quality
  const useful = notes.filter((n) => /state=RESULTS/.test(n)).length;
  const total = runs.length || 1;
  const usefulRate = useful / total;

  // verification rejection rate
  const totalRetrieved = verification.reduce((s, v) => s + (v?.retrieved ?? 0), 0);
  const totalRejected = verification.reduce((s, v) => s + (v?.rejected ?? 0), 0);
  const rejectionRate = totalRetrieved > 0 ? totalRejected / totalRetrieved : null;

  // image-missing rate (only image_missing, not model_schema or other failures)
  const totalImageMissing = verification.reduce((s, v) => s + (v?.image_failure_reasons?.image_missing ?? 0), 0);
  const imageMissingRate = totalRetrieved > 0 ? totalImageMissing / totalRetrieved : null;

  // cost from raw runs
  const costRows = pricing ? computeRunCosts(run, pricing) : [];
  const costs = costRows.map((r) => r.total_usd);
  const validCosts = costs.filter((c) => c !== null);
  const totalCost = validCosts.length ? validCosts.reduce((a, b) => a + b, 0) : null;
  const meanCost = validCosts.length ? totalCost / validCosts.length : null;
  const medianCost = validCosts.length ? percentile(validCosts, 50) : null;
  const costPerUseful = useful > 0 && totalCost != null ? totalCost / useful : null;

  // stage totals
  const stages = {};
  if (costRows.length) {
    for (const row of costRows) {
      if (row.verification_usd != null) stages.verification = (stages.verification ?? 0) + row.verification_usd;
      stages.commerce = (stages.commerce ?? 0) + row.commerce_usd;
    }
  } else {
    // fallback to summary if present
    const summary = run.summary ?? {};
    if (summary.stage_totals_usd) Object.assign(stages, summary.stage_totals_usd);
  }

  // latency
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);

  return {
    sample_size: runs.length,
    useful,
    useful_rate: usefulRate,
    cost_per_useful: costPerUseful,
    rejection_rate: rejectionRate,
    image_missing_rate: imageMissingRate,
    mean_cost: meanCost,
    median_cost: medianCost,
    p50_latency: p50,
    p95_latency: p95,
    stage_totals: stages,
  };
}

// ── compare two metric sets ────────────────────────────────────────
// direction: 'pp' = percentage-point comparison, else relative %
// failDirection: 'increase' = candidate > baseline is bad (cost, latency, rejection),
//                'decrease' = candidate < baseline is bad (useful rate)
function compareMetric(baseline, candidate, key, { direction = 'increase', failDirection = 'increase', threshold } = {}) {
  const b = baseline[key];
  const c = candidate[key];
  if (b === null || b === undefined || c === null || c === undefined) {
    return { baseline: b, candidate: c, delta: null, delta_pct: null, status: 'PASS' };
  }
  const delta = c - b;
  const deltaPct = pctDelta(b, c);
  const thresh = threshold ?? (direction === 'pp' ? THRESHOLDS.useful_rate_drop_pp : THRESHOLDS.latency_increase_pct);

  let st;
  if (direction === 'pp') {
    // rate is in [0,1]; threshold is in percentage points
    const deltaPP = Math.abs(delta) * 100;
    const bad = failDirection === 'increase' ? delta > 0 : delta < 0;
    st = !bad ? 'PASS' : deltaPP > thresh ? 'FAIL' : 'WARN';
  } else {
    // for cost/latency, an increase is bad
    st = delta <= 0 ? 'PASS' : deltaPct > thresh ? 'FAIL' : 'WARN';
  }
  return { baseline: b, candidate: c, delta, delta_pct: deltaPct, status: st };
}

export function compare(baselineRun, candidateRun, pricing) {
  const b = extractMetrics(baselineRun, pricing);
  const c = extractMetrics(candidateRun, pricing);

  const quality = {
    useful_rate: compareMetric(b, c, 'useful_rate', { direction: 'pp', failDirection: 'decrease' }),
    cost_per_useful: compareMetric(b, c, 'cost_per_useful', { direction: 'increase', threshold: THRESHOLDS.cost_increase_pct }),
    rejection_rate: compareMetric(b, c, 'rejection_rate', { direction: 'pp', failDirection: 'increase', threshold: THRESHOLDS.rate_increase_pp }),
    image_missing_rate: compareMetric(b, c, 'image_missing_rate', { direction: 'pp', failDirection: 'increase', threshold: THRESHOLDS.rate_increase_pp }),
  };

  const latency = {
    p50: compareMetric(b, c, 'p50_latency', { direction: 'increase' }),
    p95: compareMetric(b, c, 'p95_latency', { direction: 'increase' }),
  };

  const cost = {
    mean: compareMetric(b, c, 'mean_cost', { direction: 'increase', threshold: THRESHOLDS.cost_increase_pct }),
    median: compareMetric(b, c, 'median_cost', { direction: 'increase', threshold: THRESHOLDS.cost_increase_pct }),
    stage_totals: {},
  };

  if (b.stage_totals && c.stage_totals) {
    for (const k of new Set([...Object.keys(b.stage_totals), ...Object.keys(c.stage_totals)])) {
      cost.stage_totals[k] = compareMetric(
        { v: b.stage_totals[k] ?? 0 },
        { v: c.stage_totals[k] ?? 0 },
        'v',
        { direction: 'increase', threshold: THRESHOLDS.cost_increase_pct },
      );
    }
  }

  // overall status: quality failure is immediate FAIL
  const allStatuses = [
    ...Object.values(quality).map((m) => m.status),
    ...Object.values(latency).map((m) => m.status),
    cost.mean.status,
    cost.median.status,
  ];
  const overall = allStatuses.includes('FAIL') ? 'FAIL'
    : allStatuses.includes('WARN') ? 'WARN' : 'PASS';

  return { baseline: b, candidate: c, quality, latency, cost, overall };
}

// ── compact one-liner ──────────────────────────────────────────────
export function compactSummary(diff) {
  const parts = [];
  if (diff.cost.mean.delta_pct !== null) {
    const sign = diff.cost.mean.delta_pct <= 0 ? '' : '+';
    parts.push(`cost ${sign}${diff.cost.mean.delta_pct.toFixed(1)}%`);
  }
  if (diff.latency.p50.delta_pct !== null) {
    const sign = diff.latency.p50.delta_pct <= 0 ? '' : '+';
    parts.push(`p50 ${sign}${diff.latency.p50.delta_pct.toFixed(1)}%`);
  }
  if (diff.latency.p95.delta_pct !== null) {
    const sign = diff.latency.p95.delta_pct <= 0 ? '' : '+';
    parts.push(`p95 ${sign}${diff.latency.p95.delta_pct.toFixed(1)}%`);
  }
  const bRate = (diff.quality.useful_rate.baseline * 100).toFixed(0);
  const cRate = (diff.quality.useful_rate.candidate * 100).toFixed(0);
  parts.push(`useful ${bRate}% → ${cRate}%`);
  return parts.join(' · ');
}

// ── pretty-print report ────────────────────────────────────────────
export function formatReport(diff) {
  const lines = [];
  const arrow = (s) => s === 'PASS' ? '✓' : s === 'WARN' ? '⚠' : '✗';
  const fmt = (v, unit = '') => v != null ? `${typeof v === 'number' ? v.toFixed(4) : v}${unit}` : '—';
  const fmtPct = (v) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—';

  lines.push(`OVERALL: ${arrow(diff.overall)} ${diff.overall}`);
  lines.push('');
  lines.push('QUALITY');
  for (const [k, v] of Object.entries(diff.quality)) {
    lines.push(`  ${arrow(v.status)} ${k}: ${fmt(v.baseline)} → ${fmt(v.candidate)} (${fmtPct(v.delta_pct)})`);
  }
  lines.push('');
  lines.push('LATENCY');
  for (const [k, v] of Object.entries(diff.latency)) {
    lines.push(`  ${arrow(v.status)} ${k}: ${fmt(v.baseline, 'ms')} → ${fmt(v.candidate, 'ms')} (${fmtPct(v.delta_pct)})`);
  }
  lines.push('');
  lines.push('COST');
  lines.push(`  ${arrow(diff.cost.mean.status)} mean: $${fmt(diff.cost.mean.baseline)} → $${fmt(diff.cost.mean.candidate)} (${fmtPct(diff.cost.mean.delta_pct)})`);
  lines.push(`  ${arrow(diff.cost.median.status)} median: $${fmt(diff.cost.median.baseline)} → $${fmt(diff.cost.median.candidate)} (${fmtPct(diff.cost.median.delta_pct)})`);
  if (Object.keys(diff.cost.stage_totals).length) {
    lines.push('  stages:');
    for (const [k, v] of Object.entries(diff.cost.stage_totals)) {
      lines.push(`    ${arrow(v.status)} ${k}: $${fmt(v.baseline)} → $${fmt(v.candidate)} (${fmtPct(v.delta_pct)})`);
    }
  }

  lines.push('');
  lines.push(compactSummary(diff));
  return lines.join('\n');
}

// ── CLI ────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('compare.mjs')) {
  const baselinePath = process.argv[2];
  const candidatePath = process.argv[3];
  const pricingPath = process.argv[4] ?? 'tests/cost/pricing-2026-09-16.json';
  if (!baselinePath || !candidatePath) {
    console.error('Usage: node tests/cost/compare.mjs <baseline.json> <candidate.json> [pricing.json]');
    process.exit(1);
  }
  const [baselineRaw, candidateRaw, pricing] = await Promise.all([
    readFile(baselinePath, 'utf8').then(JSON.parse),
    readFile(candidatePath, 'utf8').then(JSON.parse),
    readFile(pricingPath, 'utf8').then(JSON.parse).catch(() => null),
  ]);
  const diff = compare(baselineRaw, candidateRaw, pricing);
  console.log(formatReport(diff));
  process.exit(diff.overall === 'FAIL' ? 1 : 0);
}
