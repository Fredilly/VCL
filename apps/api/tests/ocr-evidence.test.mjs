import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeOcrEvidence, normalizeOcrEvidence, shouldRunOcrRecovery } from '../dist/src/ocr-evidence.js';

const base = {
  category: 'Sportswear',
  subcategory: 'Basketball Jersey',
  brand_candidate: null,
  model_candidate: null,
  color: 'Red',
  material: 'Polyester',
  style_attributes: [],
  visible_text: [],
  logos_markings: [],
  distinctive_features: [],
  hardware_details: [],
  shape_silhouette: [],
  search_terms: ['Red Basketball Jersey'],
  confidence: 0.9,
  identity_confidence: 0.2,
  evidence_confidence: { visible_text: 0 },
};

test('runs text recovery only for weak-identity text-sensitive products', () => {
  assert.equal(shouldRunOcrRecovery(base), true);
  assert.equal(shouldRunOcrRecovery({ ...base, identity_confidence: 0.8 }), false);
  assert.equal(shouldRunOcrRecovery({ ...base, brand_candidate: 'Nike' }), false);
  assert.equal(shouldRunOcrRecovery({ ...base, category: 'Furniture', subcategory: 'Chair' }), false);
});

test('high-confidence product text raises visible-text evidence confidence', () => {
  const evidence = normalizeOcrEvidence({ visible_text: ['DURANT', '7'], confidence: 0.93 });
  const merged = mergeOcrEvidence(base, evidence);
  assert.deepEqual(merged.visible_text, ['DURANT', '7']);
  assert.equal(merged.evidence_confidence.visible_text, 0.93);
});

test('weak text recovery is ignored', () => {
  const evidence = normalizeOcrEvidence({ visible_text: ['DUR4NT'], confidence: 0.4 });
  const merged = mergeOcrEvidence(base, evidence);
  assert.deepEqual(merged.visible_text, []);
  assert.equal(merged.evidence_confidence.visible_text, 0);
});
