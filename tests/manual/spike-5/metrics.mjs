export function summarize(rows) {
  const latency = rows.map((row) => row.latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = (p) => latency.length ? latency[Math.ceil(latency.length * p) - 1] : null;
  const usefulOrGraceful = rows.filter((row) => row.useful_enough_to_click || row.truthful_low_confidence).length;
  return {
    sessions: rows.length,
    useful_or_graceful_sessions: usefulOrGraceful,
    false_exact: rows.filter((row) => row.false_exact).length,
    false_likely: rows.filter((row) => row.false_likely).length,
    no_result: rows.filter((row) => row.no_result).length,
    graceful_responses: rows.filter((row) => row.truthful_low_confidence).length,
    p50_latency_ms: percentile(0.5),
    p95_latency_ms: percentile(0.95),
    provider_failures: rows.filter((row) => row.failures?.provider).length,
    capture_failures: rows.filter((row) => row.failures?.capture).length,
    overlay_failures: rows.filter((row) => row.failures?.overlay).length,
    pass: rows.length === 10 && usefulOrGraceful >= 8 && !rows.some((row) => row.false_exact || row.false_likely),
  };
}
