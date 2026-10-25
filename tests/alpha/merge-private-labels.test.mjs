import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePrivateLabels } from '../../tools/merge-private-labels.mjs';

const labels = cases => ({ schema: 'scoop-private-labels-v1', cases });
const review = () => ({ clicks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] });

test('maps truth vocabulary and requires signature, ids, and known cases', () => {
  const { reviewFile, report } = mergePrivateLabels(review(), labels([
    { case_id: 'a', truth: 'IN_ROSTER', canonical_product_id: 'p1', reviewed_by: 'r' },
    { case_id: 'b', truth: 'OUT_OF_ROSTER', reviewed_by: 'r' },
    { case_id: 'c', truth: 'IN_ROSTER', reviewed_by: 'r' },
    { case_id: 'd', truth: 'AMBIGUOUS' },
    { case_id: 'zz', truth: 'OUT_OF_ROSTER', reviewed_by: 'r' },
    { case_id: 'e', truth: 'UNREVIEWED', reviewed_by: 'r' }
  ]));
  const by = Object.fromEntries(reviewFile.clicks.map(c => [c.id, c]));
  assert.equal(by.a.truth, 'SKU'); assert.equal(by.a.true_sku, 'p1');
  assert.equal(by.b.truth, 'NONE'); assert.equal(by.b.true_sku, null);
  assert.equal(by.c.truth, undefined); assert.equal(by.d.truth, undefined);
  assert.deepEqual(report.applied, ['a', 'b']);
  assert.deepEqual(report.skipped.map(s => s.reason).sort(),
    ['NOT_IN_REVIEW_FILE', 'NOT_SIGNED', 'SKU_WITHOUT_ID', 'UNREVIEWED_OR_UNKNOWN_TRUTH']);
});

test('does not silently overwrite a signed label', () => {
  const r = { clicks: [{ id: 'a', truth: 'NONE', reviewed_by: 'x' }] };
  const { report } = mergePrivateLabels(r, labels([{ case_id: 'a', truth: 'AMBIGUOUS', reviewed_by: 'y' }]));
  assert.equal(report.conflicts.length, 1);
  assert.equal(r.clicks[0].truth, 'NONE');
});

test('rejects other schemas', () => {
  assert.throws(() => mergePrivateLabels(review(), { schema: 'x', cases: [] }));
});
