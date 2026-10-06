export function summarize(rows) {
  const completed = rows.filter(r => r.status === 'OK');
  const identified = completed.filter(r => r.predicted_class !== 'NONE' && r.predicted_class !== 'UNKNOWN');
  const positives = rows.filter(r => r.truth === 'IN_ROSTER');
  const negatives = rows.filter(r => r.truth === 'OUT_OF_ROSTER');
  const ambiguous = rows.filter(r => r.truth === 'AMBIGUOUS');
  const falseExact = completed.filter(r => r.result_class === 'EXACT' &&
    (r.truth !== 'IN_ROSTER' || r.predicted_class !== r.expected_class));
  const correct = completed.filter(r => r.truth !== 'AMBIGUOUS' && r.predicted_class === r.expected_class);
  const rate = (n, d) => d ? n / d : null;
  const eligible = rows.filter(r => r.truth !== 'AMBIGUOUS');
  return {
    observations: rows.length,
    top1_accuracy: rate(correct.length, eligible.length),
    in_roster_accuracy: rate(positives.filter(r => r.status === 'OK' && r.predicted_class === r.expected_class).length, positives.length),
    false_exact: falseExact.length,
    false_exact_ids: falseExact.map(r => r.id),
    none_recall: rate(negatives.filter(r => r.status === 'OK' && r.predicted_class === 'NONE').length, negatives.length),
    none_precision: rate(completed.filter(r => r.predicted_class === 'NONE' && r.truth === 'OUT_OF_ROSTER').length, completed.filter(r => r.predicted_class === 'NONE').length),
    ambiguity_abstention: rate(ambiguous.filter(r => r.status === 'OK' && ['NONE', 'UNKNOWN'].includes(r.predicted_class)).length, ambiguous.length),
    exact_coverage: rate(completed.filter(r => r.result_class === 'EXACT').length, rows.length),
    false_assignment: identified.filter(r => r.predicted_class !== r.expected_class).length,
    provider_blocked: rows.filter(r => r.status === 'PROVIDER_BLOCKED').length,
    system_failures: rows.filter(r => r.status === 'SYSTEM_FAIL').length,
    by_scenario: Object.fromEntries([...new Set(rows.map(r => r.scenario))].map(s => {
      const subset = rows.filter(r => r.scenario === s);
      return [s, { cases: subset.length, false_exact: falseExact.filter(r => r.scenario === s).length,
        correct: subset.filter(r => r.status === 'OK' && (r.truth === 'AMBIGUOUS'
          ? ['NONE', 'UNKNOWN'].includes(r.predicted_class) : r.predicted_class === r.expected_class)).length }];
    })),
  };
}

// Frozen evidence regressions must all pass. Image benchmark promotion defaults
// are provisional engineering gates, not claimed production quality.
export function gate(metrics, { top1 = 1, noneRecall = 1, ambiguity = 1 } = {}) {
  const failures = [];
  if (!metrics.observations) failures.push('EMPTY_CORPUS');
  if (metrics.false_exact) failures.push('FALSE_EXACT');
  if (metrics.top1_accuracy === null || metrics.top1_accuracy < top1) failures.push('TOP1_ACCURACY');
  if (metrics.none_recall === null || metrics.none_recall < noneRecall) failures.push('NONE_RECALL');
  if (metrics.ambiguity_abstention === null || metrics.ambiguity_abstention < ambiguity) failures.push('AMBIGUITY_ABSTENTION');
  if (metrics.provider_blocked) failures.push('PROVIDER_BLOCKED');
  if (metrics.system_failures) failures.push('SYSTEM_FAIL');
  return { passed: !failures.length, failures };
}
