export function summarize(rows) {
  const values = (pick) => rows.map(pick).filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = (latency, p) => latency.length ? latency[Math.ceil(latency.length * p) - 1] : null;
  const totals = values((row) => row.latency?.total_ms ?? row.latency_ms);
  const stage = (key) => {
    const latency = values((row) => row.latency?.[key]);
    return { samples: latency.length, p50_ms: percentile(latency, 0.5), p95_ms: percentile(latency, 0.95) };
  };
  const usefulOrGraceful = rows.filter((row) => row.useful_enough_to_click || row.truthful_low_confidence).length;
  return {
    sessions: rows.length,
    useful_or_graceful_sessions: usefulOrGraceful,
    false_exact: rows.filter((row) => row.false_exact).length,
    false_likely: rows.filter((row) => row.false_likely).length,
    no_result: rows.filter((row) => row.no_result).length,
    graceful_responses: rows.filter((row) => row.truthful_low_confidence).length,
    latency_samples: totals.length,
    p50_latency_ms: percentile(totals, 0.5),
    p95_latency_ms: percentile(totals, 0.95),
    latency_breakdown: {
      capture: stage('capture_ms'),
      localization: stage('localization_ms'),
      vision: stage('vision_ms'),
      commerce_and_verification: stage('commerce_and_verification_ms'),
      candidate_verification: { samples: 0, p50_ms: null, p95_ms: null, combined_with: 'commerce_and_verification' },
      total: { samples: totals.length, p50_ms: percentile(totals, 0.5), p95_ms: percentile(totals, 0.95) },
    },
    provider_failures: rows.filter((row) => row.failures?.provider).length,
    capture_failures: rows.filter((row) => row.failures?.capture).length,
    overlay_failures: rows.filter((row) => row.failures?.overlay).length,
    pass: rows.length === 10 && usefulOrGraceful >= 8 && !rows.some((row) => row.false_exact || row.false_likely),
  };
}
