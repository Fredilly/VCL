import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const CLASSES = ['EXACT', 'LIKELY', 'SIMILAR', 'NO_RESULT'];
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ratio = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
const count = (rows, predicate) => rows.filter(predicate).length;
export function percentile(values, p) {
  assert(p > 0 && p <= 1);
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;
}

export function validateCorpus(corpus) {
  assert.equal(corpus.schema_version, 1);
  assert(corpus.selections.length >= 25 && corpus.selections.length <= 50, 'Corpus must contain 25–50 selections');
  assert.equal(new Set(corpus.selections.map(s => s.id)).size, corpus.selections.length, 'Duplicate selection ID');
  for (const selection of corpus.selections) {
    assert(selection.id && selection.category && selection.notes && selection.source, 'Missing selection metadata');
    assert(CLASSES.includes(selection.expected_classification), 'Invalid expected classification');
    assert.equal(typeof selection.clear_branding, 'boolean');
    assert(['known', 'unknown'].includes(selection.ground_truth.status));
    if (selection.ground_truth.status === 'known') {
      assert(selection.ground_truth.identity && selection.ground_truth.evidence, 'Known identity requires independent evidence');
    } else assert.equal(selection.ground_truth.identity, null, 'Unknown identity must stay unknown');
  }
  return corpus;
}

// Reviews are kept outside model/provider input. Candidate IDs are scoped by provenance,
// never matched by rank, query keywords, or the system's own identity_key.
export const candidateKey = candidate => `${candidate.provenance}:${candidate.id}`;
export function scoreSelection(selection, observation, review) {
  assert.equal(observation.selection_id, selection.id);
  assert(Number.isFinite(observation.latency_ms) && observation.latency_ms >= 0);
  assert.equal(review?.observation_sha256, digest(observation), `Missing/stale review for ${selection.id}`);
  const products = observation.response?.products ?? [];
  assert(Array.isArray(products));
  const top = products[0] ?? null;
  const classification = top?.result_class ?? 'NO_RESULT';
  assert(CLASSES.includes(classification));
  const evaluated = products.map(product => {
    assert(product.provider && product.provenance && product.id, 'Missing provider provenance');
    assert(CLASSES.includes(product.result_class) && product.result_class !== 'NO_RESULT');
    const label = review.candidates[candidateKey(product)];
    assert(label && typeof label.useful === 'boolean' && label.notes, `Unreviewed candidate ${candidateKey(product)}`);
    assert(label.correct === null || typeof label.correct === 'boolean');
    if (selection.ground_truth.status === 'unknown') assert.equal(label.correct, null, 'Unknown source cannot establish exact correctness');
    return { ...product, adjudication: label };
  });
  const exact = evaluated.filter(p => p.result_class === 'EXACT');
  const falseExact = exact.some(p => p.adjudication.correct === false);
  const unverifiedExact = exact.some(p => p.adjudication.correct === null);
  return {
    selection_id: selection.id, category: selection.category, difficulty: selection.difficulty,
    ground_truth: selection.ground_truth, source: selection.source, clear_branding: selection.clear_branding,
    expected_classification: selection.expected_classification, actual_classification: classification,
    top_candidate: top, top_candidate_correct: top ? evaluated[0].adjudication.correct : null,
    useful_result: evaluated.some(p => p.adjudication.useful), false_exact: falseExact,
    unverified_exact: unverifiedExact, no_result: !top, latency_ms: observation.latency_ms,
    resolver_latency_ms: observation.response?.latency_ms ?? null,
    provider_provenance: [...new Set(evaluated.map(p => p.provenance))],
    providers_used: observation.response?.providers_used ?? [],
    multi_frame_requested: Boolean(selection.nearby_timestamps?.length),
    multi_frame_used: (observation.analysis?.multi_frame?.frames_used ?? 1) > 1,
    multi_frame_contributed: (observation.analysis?.multi_frame?.frames_contributing ?? 1) > 1,
    multi_frame: observation.analysis?.multi_frame ?? null,
    provider_observations: observation.provider_observations ?? [],
    state: observation.response?.state ?? 'REQUEST_FAILED', error: observation.error ?? null,
    notes: [selection.notes, review.notes], candidates: evaluated,
  };
}

export function summarize(rows) {
  const precision = kind => {
    const predictions = rows.filter(r => r.actual_classification === kind);
    const judged = predictions.filter(r => r.top_candidate_correct !== null);
    return { ...ratio(count(judged, r => r.top_candidate_correct), judged.length),
      claims: predictions.length, unknown: predictions.length - judged.length };
  };
  const providers = rows.flatMap(r => r.provider_observations).filter(p => p.observable);
  const known = rows.filter(r => r.ground_truth.status === 'known');
  const allExact = rows.flatMap(r => r.candidates.filter(p => p.result_class === 'EXACT'));
  const categories = Object.fromEntries([...new Set(rows.map(r => r.category))].map(c => [c, count(rows, r => r.category === c)]));
  return {
    selections: rows.length, category_mix: categories, known_identity: known.length, unknown_identity: rows.length - known.length,
    exact_precision: precision('EXACT'), likely_precision: precision('LIKELY'),
    false_exact_rate: ratio(count(rows, r => r.false_exact), rows.length),
    unverified_exact_selections: count(rows, r => r.unverified_exact),
    all_returned_exact: { claims: allExact.length, false: count(allExact, p => p.adjudication.correct === false), unknown: count(allExact, p => p.adjudication.correct === null) },
    useful_result_rate: ratio(count(rows, r => r.useful_result), rows.length),
    no_result_rate: ratio(count(rows, r => r.no_result), rows.length),
    known_top_identity_accuracy: ratio(count(known, r => r.top_candidate_correct === true), known.length),
    p50_latency_ms: percentile(rows.map(r => r.latency_ms), .5), p95_latency_ms: percentile(rows.map(r => r.latency_ms), .95),
    provider_failure_rate: ratio(count(providers, p => p.failed), providers.length),
    multi_frame_used: count(rows, r => r.multi_frame_used), multi_frame_contributed: count(rows, r => r.multi_frame_contributed),
    request_failures: count(rows, r => r.error !== null),
    false_likely_selections: rows.filter(r => r.actual_classification === 'LIKELY' && r.top_candidate_correct === false).map(r => r.selection_id),
  };
}

export function reportMarkdown(report) {
  const m = report.metrics;
  const rate = x => x.value === null ? `N/A (${x.numerator}/${x.denominator})` : `${(x.value * 100).toFixed(1)}% (${x.numerator}/${x.denominator})`;
  const text = x => String(x ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
  return `# Spike 4f exact-match benchmark\n\nDecision: **${report.decision}**. Mode: ${report.mode}.\n\n${report.limitations.join(' ')}\n\n` +
    `Selections: ${m.selections}; known ${m.known_identity}, unknown ${m.unknown_identity}. Categories: ${Object.entries(m.category_mix).map(([k, v]) => `${k} ${v}`).join(', ')}.\n\n` +
    `| Metric | Result |\n| --- | --- |\n${[
      ['Exact precision (top, judged)', rate(m.exact_precision)], ['Likely precision (top, judged)', rate(m.likely_precision)],
      ['False-EXACT selections (any returned rank)', rate(m.false_exact_rate)], ['Unverified EXACT selections', m.unverified_exact_selections],
      ['Useful-result rate (any returned rank)', rate(m.useful_result_rate)], ['No-result rate', rate(m.no_result_rate)],
      ['P50 / P95 latency (ms)', `${m.p50_latency_ms} / ${m.p95_latency_ms}`], ['Provider failure rate (observable only)', rate(m.provider_failure_rate)],
      ['Multi-frame used / contributed', `${m.multi_frame_used} / ${m.multi_frame_contributed}`],
    ].map(([k, v]) => `| ${k} | ${v} |`).join('\n')}\n\n` +
    `False EXACT: ${report.rows.filter(r => r.false_exact).map(r => r.selection_id).join(', ') || 'none'}. Unverified EXACT: ${report.rows.filter(r => r.unverified_exact).map(r => r.selection_id).join(', ') || 'none'}.\n\n` +
    `False LIKELY: ${m.false_likely_selections.join(', ') || 'none'}.\n\n` +
    `| Selection | Expected | Actual | Top candidate | Correct | Useful | False EXACT | No result | ms |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n` +
    report.rows.map(r => `| ${[r.selection_id, r.expected_classification, r.actual_classification, r.top_candidate?.title, r.top_candidate_correct, r.useful_result, r.false_exact, r.no_result, r.latency_ms].map(text).join(' | ')} |`).join('\n') + '\n';
}
