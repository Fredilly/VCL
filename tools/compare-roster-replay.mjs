import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Measure an intake roster against a replayed session.
 *
 *   node tools/compare-roster-replay.mjs <intake-dir> <roster-replay.json> [baseline-replay.json] [labels.json]
 *
 * Prints counts and identity handles only: no titles, images, crops or
 * credentials. What it can and cannot say:
 * - READY rows, verified reference images and valid (seller-confirmed) offers
 *   come straight from the intake report.
 * - Without reviewed labels there is no SKU accuracy and no false-EXACT rate.
 *   The tool then reports both as NOT_MEASURABLE and never substitutes a proxy.
 * - "window consistency" is printed separately and is NOT accuracy: it only
 *   says whether an EXACT landed inside the discussion window its roster row
 *   inherited. A product can be on screen outside its window and vice versa.
 */

const read = file => JSON.parse(readFileSync(file, 'utf8'));
const tally = values => values.reduce((out, value) => ({ ...out, [value ?? 'none']: (out[value ?? 'none'] ?? 0) + 1 }), {});
const handle = key => typeof key === 'string' ? key.replace(/^(verified|video-local|roster-candidate):/, '').toLowerCase() : null;
/** Does the top result come from this video's roster (as Exact, or as a SIMILAR suggestion)? */
const rosterBacked = key => typeof key === 'string' && /^(verified|video-local|roster-candidate):/.test(key);
const percentile = (values, p) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null; };
const flat = value => (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export function intakeMetrics(report) {
  const items = report.items ?? [];
  const ready = items.filter(item => item.status === 'READY');
  const offers = items.flatMap(item => item.offers ?? []);
  return {
    rows: items.length,
    ready: ready.length,
    needs_review: items.filter(item => item.status === 'NEEDS_REVIEW').length,
    unresolved: items.filter(item => item.status === 'UNRESOLVED').length,
    verified_images: items.filter(item => item.verified_image).length,
    ready_with_verified_image: ready.filter(item => item.verified_image).length,
    listing_photos_loaded: new Set(offers.map(offer => offer.image).filter(Boolean)).size,
    valid_offers: offers.filter(offer => offer.availability === 'in_stock').length,
    valid_offers_on_ready_rows: ready.flatMap(item => item.offers ?? []).filter(offer => offer.availability === 'in_stock').length,
    offers_by_state: tally(offers.map(offer => offer.availability ?? 'unconfirmed')),
    seller_availability_wording: tally(offers.map(offer => `${offer.provider}:${offer.page}:${offer.availability_stated ?? 'not stated'}`)),
    pages_by_state: tally(offers.map(offer => offer.page ?? 'unread')),
    identity_basis: tally(items.map(item => item.sku_source)),
    ready_identity_basis: tally(ready.map(item => item.sku_source)),
    rejected_links: items.reduce((sum, item) => sum + (item.rejected_links?.length ?? 0), 0),
    blocking_reasons: tally(items.flatMap(item => (item.reasons ?? []).map(reason => reason.split(':')[0]))),
  };
}

export function replayMetrics(replay, roster = []) {
  const rows = replay.rows ?? [];
  const current = rows.map(row => row.current ?? {});
  const windows = new Map();
  for (const mapping of roster) {
    if (typeof mapping.candidate_window_start_ms !== 'number' || typeof mapping.candidate_window_end_ms !== 'number') continue;
    windows.set(flat(mapping.product_id), [mapping.candidate_window_start_ms, mapping.candidate_window_end_ms]);
  }
  const exact = rows.filter(row => row.current?.top_class === 'EXACT');
  const consistency = exact.map(row => {
    const window = windows.get(flat(handle(row.current.top_identity)));
    if (!window || typeof row.video_timestamp_ms !== 'number') return 'no_window';
    return row.video_timestamp_ms >= window[0] && row.video_timestamp_ms <= window[1] ? 'inside_window' : 'outside_window';
  });
  return {
    cases: rows.length,
    completed: rows.filter(row => row.status === 'OK').length,
    top_class: tally(current.map(value => value.top_class)),
    exact: exact.length,
    exact_by_identity_kind: tally(exact.map(row => /^video-local:/.test(row.current.top_identity ?? '') ? 'video_local' : 'manufacturer_or_listing')),
    distinct_exact_identities: new Set(exact.map(row => row.current.top_identity)).size,
    mapping_reason: tally(current.map(value => value.mapping_reason)),
    roster_sources: tally(current.map(value => value.roster_sources ? JSON.stringify(value.roster_sources) : 'not_reported')),
    unresolved_roster_comparisons: current.reduce((sum, value) => sum + (value.roster_unresolved ?? 0), 0),
    visual_failure_reasons: current.reduce((out, value) => {
      for (const [reason, count] of Object.entries(value.visual_failure_reasons ?? {})) out[reason] = (out[reason] ?? 0) + count;
      return out;
    }, {}),
    exact_window_consistency_not_accuracy: tally(consistency),
    // "Roster-backed" = the top result is a product from this video's list:
    // an Exact, or a SIMILAR suggestion. Before this change it was always 0.
    roster_backed_top: tally(current.filter(value => rosterBacked(value.top_identity)).map(value => value.top_class)),
    head_to_head: tally(current.filter(value => value.head_to_head).map(value => value.head_to_head.outcome)),
    latency_ms: { p50: percentile(current.map(value => value.latency_ms), 0.5), p95: percentile(current.map(value => value.latency_ms), 0.95) },
    acceptance: replay.acceptance?.status ?? null,
  };
}

/** "VR-<video>-<section>-<variant>" -> section number; null for any other id. */
const sectionOf = id => { const match = /^vr-.{4,20}?-(\d{1,3})-/i.exec(id ?? ''); return match ? Number(match[1]) : null; };
const shortId = id => (id ?? '').replace(/^vr-[a-z0-9_-]{4,20}?-(?=\d{1,3}-)/i, '');

/**
 * How the verifier ranked the roster on each click, next to the partner's own
 * discussion window for that moment. The window is a WEAK reference: it says
 * which product the creator was talking about, not which object was clicked.
 * Agreement here is a sanity signal for ranking quality, never accuracy.
 */
export function rankingDiagnostics(replay, roster = []) {
  // A family is an outline section for intake variants, and the row itself for
  // hand-seeded rows (each seed is one family).
  const familyOf = id => sectionOf(id) ?? flat(id);
  // Result identity keys are normalised (no punctuation), so match them back to a roster id first.
  const rosterIds = new Map(roster.map(row => [flat(row.product_id), row.product_id]));
  const familyOfHandle = value => familyOf(rosterIds.get(flat(value)) ?? value);
  const windows = new Map();
  for (const row of roster) {
    if (typeof row.candidate_window_start_ms !== 'number' || typeof row.candidate_window_end_ms !== 'number') continue;
    windows.set(familyOf(row.product_id), [row.candidate_window_start_ms, row.candidate_window_end_ms]);
  }
  const cases = (replay.rows ?? []).map((row, index) => {
    const scored = (row.current?.scores ?? []).filter(score => typeof score.similarity === 'number')
      .sort((a, b) => b.similarity - a.similarity || (b.confidence ?? 0) - (a.confidence ?? 0));
    const t = row.video_timestamp_ms;
    const inWindow = typeof t === 'number' ? [...windows].filter(([, [start, end]]) => t >= start && t <= end).map(([section]) => section) : [];
    return {
      n: index + 1, t_s: typeof t === 'number' ? Math.round(t / 1000) : null,
      window_section: inWindow.length === 1 ? inWindow[0] : null,
      scored: scored.length, unscored: (row.current?.scores ?? []).length - scored.length,
      top: scored.slice(0, 6).map(score => `${shortId(score.id)} ${score.similarity.toFixed(2)}/${(score.confidence ?? 0).toFixed(2)}/${score.details}${score.strict && score.strict !== 'below_similarity' ? ` ${score.strict}` : ''}`),
      top_section: scored.length ? familyOf(scored[0].id) : null,
      top3_sections: [...new Set(scored.slice(0, 3).map(score => familyOf(score.id)))],
      window_rank: inWindow.length === 1 ? (() => { const at = scored.findIndex(score => familyOf(score.id) === inWindow[0]); return at < 0 ? null : at + 1; })() : null,
      decision: row.current?.mapping_reason ?? null, class: row.current?.top_class ?? null,
      identity: rosterBacked(row.current?.top_identity) ? row.current.top_identity : null,
      result_in_window_family: inWindow.length === 1 && rosterBacked(row.current?.top_identity)
        ? familyOfHandle(handle(row.current.top_identity)) === inWindow[0] : null,
      round: (row.current?.scores ?? []).filter(score => typeof score.round_similarity === 'number')
        .map(score => `${shortId(score.id)} ${score.round_similarity.toFixed(2)}/${(score.round_confidence ?? 0).toFixed(2)}${score.round_strict && score.round_strict !== 'below_similarity' ? ` ${score.round_strict}` : ''}`),
      head_to_head: row.current?.head_to_head?.outcome ?? null,
      latency_ms: row.current?.latency_ms ?? null,
      margin: scored.length > 1 ? Number((scored[0].similarity - scored[1].similarity).toFixed(2)) : null,
      confident_090: scored.filter(score => (score.confidence ?? 0) >= 0.9).length,
    };
  });
  const windowed = cases.filter(item => item.window_section != null && item.scored > 0);
  return {
    note: 'Discussion windows are a weak reference, not ground truth.',
    cases_with_scores: cases.filter(item => item.scored > 0).length,
    cases_in_one_window: windowed.length,
    top1_in_window_family: windowed.filter(item => item.top_section === item.window_section).length,
    top3_include_window_family: windowed.filter(item => item.top3_sections.includes(item.window_section)).length,
    roster_backed_results_in_one_window: cases.filter(item => item.result_in_window_family !== null).length,
    roster_backed_results_in_window_family: cases.filter(item => item.result_in_window_family === true).length,
    roster_backed_results_outside_window_family: cases.filter(item => item.result_in_window_family === false).length,
    mean_candidates_scored: cases.length ? Number((cases.reduce((sum, item) => sum + item.scored, 0) / cases.length).toFixed(1)) : 0,
    mean_candidates_with_confidence_090: cases.length ? Number((cases.reduce((sum, item) => sum + item.confident_090, 0) / cases.length).toFixed(1)) : 0,
    cases,
  };
}

/** Ground truth is relative to a specific candidate roster, not merely a video.
 * Private crop-review v2 labels refer to the original ten-seed roster. The
 * 26-variant intake roster changes the meaning of NONE and uses different IDs.
 * A reviewed identity crosswalk + new roster membership labels are required
 * before scoring an intake replay against the old labels.
 */
export function accuracy(replay, labels, options = {}) {
  if (!labels) return { status: 'NOT_MEASURABLE', reason: 'No reviewed labels supplied.' };
  if (options.roster === 'intake' && labels.schema === 'scoop-private-labels-v2') {
    return { status: 'NOT_MEASURABLE', reason: 'Private v2 truth labels describe the original ten-seed roster. New intake variants change membership and identity keys; require a reviewed crosswalk and revalidated NONE labels.' };
  }
  const list = Array.isArray(labels) ? labels : labels.cases;
  if (!Array.isArray(list)) return { status: 'NOT_MEASURABLE', reason: 'Unsupported reviewed-label schema.' };
  const byCase = new Map();
  for (const label of list) {
    if (typeof label.case_id !== 'string' || byCase.has(label.case_id)) return { status: 'NOT_MEASURABLE', reason: 'Labels must have unique case_id strings.' };
    let kind;
    let expected = null;
    if (labels.schema === 'scoop-private-labels-v2') {
      kind = label.truth === 'SKU' ? 'IN' : label.truth === 'NONE' ? 'OUT' : label.truth === 'UNKNOWN' ? 'AMBIGUOUS' : null;
      expected = label.true_sku;
    } else {
      kind = label.in_roster === true ? 'IN' : label.in_roster === false ? 'OUT' : 'AMBIGUOUS';
      expected = label.expected_identity ?? label.expected_sku ?? null;
    }
    if (!kind || (kind === 'IN' && (!expected || typeof expected !== 'string'))) {
      return { status: 'NOT_MEASURABLE', reason: 'Unrecognized truth or missing expected identity in reviewed labels.' };
    }
    byCase.set(label.case_id, { kind, expected });
  }
  let inRoster = 0, outOfRoster = 0, ambiguous = 0, correct = 0, wrong = 0, misses = 0;
  let falseExact = 0, cleanReject = 0, outFallback = 0, matched = 0, exactOnUnlabeled = 0;
  const seen = new Set();
  for (const row of replay.rows ?? []) {
    if (typeof row.case_id !== 'string' || seen.has(row.case_id)) return { status: 'NOT_MEASURABLE', reason: 'Replay case IDs missing or duplicated.' };
    seen.add(row.case_id);
    const label = byCase.get(row.case_id);
    const isExact = row.current?.top_class === 'EXACT';
    if (!label) { if (isExact) exactOnUnlabeled++; continue; }
    matched++;
    if (label.kind === 'AMBIGUOUS') { ambiguous++; continue; }
    const actual = flat(handle(row.current?.top_identity) ?? '');
    if (label.kind === 'OUT') {
      outOfRoster++;
      if (isExact) falseExact++;
      else if (!row.current?.top_identity && (row.current?.mapping_reason === 'visual_rejected' || row.current?.top_class === 'NONE' && row.current?.mapping_reason !== 'incomplete_comparison')) cleanReject++;
      else outFallback++;
      continue;
    }
    inRoster++;
    const expected = flat(label.expected);
    // Keep the existing strict identity comparison. No family/name aliases:
    // the app must resolve to the correct canonical key, not a lookalike.
    if (isExact && actual && actual === expected) correct++;
    else if (isExact) { wrong++; falseExact++; }
    else misses++;
  }
  if (!matched || (!inRoster && !outOfRoster)) return { status: 'NOT_MEASURABLE', reason: 'No scored case IDs match this replay.' };
  return {
    status: 'MEASURED', matched_labels: matched, unmatched_labels: byCase.size - matched,
    in_roster_cases: inRoster, out_of_roster_cases: outOfRoster,
    ambiguous_excluded: ambiguous, correct_in_roster_exact: correct, wrong_in_roster_exact: wrong,
    missed_in_roster: misses, clean_out_of_roster_rejections: cleanReject,
    non_exact_out_of_roster_fallbacks: outFallback, false_exact: falseExact,
    exact_on_unlabeled_cases: exactOnUnlabeled,
    in_roster_exact_accuracy: inRoster ? Number((correct / inRoster).toFixed(4)) : null,
    out_of_roster_clean_rejection_rate: outOfRoster ? Number((cleanReject / outOfRoster).toFixed(4)) : null,
    false_exact_count: falseExact,
  };
}

async function replayOnly(reportFile, platform, contentRef) {
  // Seeds-only replay: windows come from the public seeds for this video.
  const replay = read(reportFile);
  let roster = [];
  try {
    const { seedsForVideo } = await import(new URL('../apps/api/dist/src/roster-seed-replacement.js', import.meta.url).href);
    roster = seedsForVideo({ platform, content_ref: contentRef });
  } catch { /* no build: ranking is still printed, without windows */ }
  console.log(JSON.stringify({ replay: replayMetrics(replay, roster), verifier_ranking: rankingDiagnostics(replay, roster) }, null, 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--replay-only') {
  await replayOnly(process.argv[3], process.argv[4] ?? 'youtube', process.argv[5] ?? '');
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [intakeDir, rosterReplay, baselineReplay, labelsFile] = process.argv.slice(2);
  if (!intakeDir) throw new Error('Usage: node tools/compare-roster-replay.mjs <intake-dir> [roster-replay.json] [baseline-replay.json] [labels.json]');
  const report = read(resolve(intakeDir, 'report.json'));
  const rosterFile = resolve(intakeDir, 'evaluation-roster.json');
  const roster = existsSync(rosterFile) ? read(rosterFile) : [];
  const plan = existsSync(resolve(intakeDir, 'seed-replacement-plan.json')) ? read(resolve(intakeDir, 'seed-replacement-plan.json')) : null;
  const labels = labelsFile && existsSync(labelsFile) ? read(labelsFile) : null;
  const out = {
    intake: intakeMetrics(report),
    evaluation_roster: { rows: roster.length, variants: new Set(roster.map(row => row.product_id)).size, video_local: new Set(roster.filter(row => row.identity_scope === 'video_local').map(row => row.product_id)).size },
    seed_replacement: plan ? { status: plan.status, ...plan.summary, entries: plan.entries.map(entry => ({ seed: entry.seed_product_id, basis: entry.basis, action: entry.action, replaced_by: entry.replaced_by.length, not_ready: entry.not_ready.length, needs_signoff: entry.needs_signoff })) } : null,
  };
  if (rosterReplay && existsSync(rosterReplay)) {
    const replay = read(rosterReplay);
    out.replay_with_intake_roster = replayMetrics(replay, roster);
    out.accuracy = accuracy(replay, labels, { roster: 'intake' });
    out.verifier_ranking = rankingDiagnostics(replay, roster);
    // Per case, handles only. The timestamp is the moment the reviewer clicked.
    out.cases = (replay.rows ?? []).map((row, index) => ({ n: index + 1, t_s: typeof row.video_timestamp_ms === 'number' ? Math.round(row.video_timestamp_ms / 1000) : null, class: row.current?.top_class ?? null, identity: row.current?.top_identity ?? null, reason: row.current?.mapping_reason ?? null, retrieved: row.current?.roster_retrieved ?? null, unresolved: row.current?.roster_unresolved ?? null, compared: row.current?.compared ?? null, failures: row.current?.visual_failure_reasons ?? null }));
  }
  if (baselineReplay && existsSync(baselineReplay)) {
    const baseline = read(baselineReplay);
    out.replay_with_seeds_only = replayMetrics(baseline);
    out.seeds_only_accuracy = accuracy(baseline, labels, { roster: 'seeds' });
    if (out.cases) (baseline.rows ?? []).forEach((row, index) => { if (out.cases[index]) Object.assign(out.cases[index], { seeds_class: row.current?.top_class ?? null, seeds_identity: row.current?.top_identity ?? null }); });
  }
  console.log(JSON.stringify(out, null, 1));
}
