// Merge independently signed private labels (scoop-private-labels-v1) into a video-SKU
// review file, using the vocabulary the review adapter understands.
//   IN_ROSTER -> SKU (needs canonical_product_id), OUT_OF_ROSTER -> NONE, AMBIGUOUS -> UNKNOWN.
// Anything unsigned, UNREVIEWED, or unknown to the review file is left out and counted.
// Labels never overwrite an existing signed label unless allowOverwrite is set.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP = { IN_ROSTER: 'SKU', OUT_OF_ROSTER: 'NONE', AMBIGUOUS: 'UNKNOWN' };

export function mergePrivateLabels(reviewFile, labelFile, { allowOverwrite = false } = {}) {
  if (labelFile?.schema !== 'scoop-private-labels-v1') throw new Error('Unsupported label schema');
  const byId = new Map((reviewFile.clicks ?? []).map(c => [c.id, c]));
  const report = { applied: [], skipped: [], conflicts: [] };
  for (const l of labelFile.cases ?? []) {
    const truth = MAP[l.truth];
    if (!truth) { report.skipped.push({ id: l.case_id, reason: 'UNREVIEWED_OR_UNKNOWN_TRUTH' }); continue; }
    if (!l.reviewed_by) { report.skipped.push({ id: l.case_id, reason: 'NOT_SIGNED' }); continue; }
    if (truth === 'SKU' && !l.canonical_product_id) { report.skipped.push({ id: l.case_id, reason: 'SKU_WITHOUT_ID' }); continue; }
    if (truth !== 'SKU' && l.canonical_product_id) { report.skipped.push({ id: l.case_id, reason: 'ID_ON_NON_SKU' }); continue; }
    const click = byId.get(l.case_id);
    if (!click) { report.skipped.push({ id: l.case_id, reason: 'NOT_IN_REVIEW_FILE' }); continue; }
    if (click.reviewed_by && !allowOverwrite && (click.truth !== truth || (click.true_sku ?? null) !== (l.canonical_product_id ?? null))) {
      report.conflicts.push({ id: l.case_id, existing: click.truth, incoming: truth }); continue;
    }
    click.truth = truth;
    click.true_sku = truth === 'SKU' ? l.canonical_product_id : null;
    click.reviewed_by = l.reviewed_by;
    click.review_notes = l.notes ?? '';
    report.applied.push(l.case_id);
  }
  return { reviewFile, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [reviewPath, labelsPath, outPath] = process.argv.slice(2);
  if (!reviewPath || !labelsPath || !outPath) { console.error('usage: merge-private-labels.mjs review.json labels.json out.json'); process.exit(2); }
  const { reviewFile, report } = mergePrivateLabels(JSON.parse(readFileSync(reviewPath, 'utf8')), JSON.parse(readFileSync(labelsPath, 'utf8')));
  writeFileSync(outPath, JSON.stringify(reviewFile, null, 2) + '\n');
  console.log(JSON.stringify({ applied: report.applied.length, skipped: report.skipped, conflicts: report.conflicts }, null, 2));
}
