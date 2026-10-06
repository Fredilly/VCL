export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function summarize(rows) {
  const positives = rows.filter((row) => row.expected_track_id);
  const negatives = rows.filter((row) => !row.expected_track_id);
  const multi = rows.filter((row) => row.expected_track_id && row.candidate_count > 1);
  const correct = positives.filter((row) => row.on_track_id === row.expected_track_id);
  const falseExact = rows.filter((row) => Boolean(row.on_track_id) && row.on_track_id !== row.expected_track_id);
  const rescued = positives.filter((row) => !row.off_track_id && row.on_track_id === row.expected_track_id);
  return {
    observations: rows.length,
    persistence_recall: positives.length ? correct.length / positives.length : 0,
    false_inherited_exact: falseExact.length,
    false_inheritance_rate: negatives.length ? negatives.filter((row) => Boolean(row.on_track_id)).length / negatives.length : 0,
    multi_track_accuracy: multi.length
      ? multi.filter((row) => row.on_track_id === row.expected_track_id).length / multi.length
      : 0,
    no_result_rescue: rescued.length,
    p50_decision_ms: percentile(rows.map((row) => row.decision_ms), 50),
    p95_decision_ms: percentile(rows.map((row) => row.decision_ms), 95),
    verification_requests: rows.reduce((sum, row) => sum + row.verification_requests, 0),
    verification_cost_usd: rows.reduce((sum, row) => sum + row.verification_cost_usd, 0),
    commerce_calls: rows.reduce((sum, row) => sum + row.commerce_calls, 0),
  };
}
