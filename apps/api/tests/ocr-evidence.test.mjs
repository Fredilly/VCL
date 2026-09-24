import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeOcrEvidence, normalizeOcrEvidence, shouldRunOcrPreview } from '../dist/src/ocr-evidence.js';

const base = {
  category: 'apparel',
  subcategory: 'T-shirt',
  brand_candidate: null,
  model_candidate: null,
  color: 'black',
  material: 'cotton',
  style_attributes: [],
  visible_text: [],
  logos_markings: [],
  distinctive_features: ['large chest graphic'],
  hardware_details: [],
  shape_silhouette: [],
  search_terms: [],
  confidence: 0.8,
  identity_confidence: 0,
};

test('requests OCR only for text-sensitive objects missing readable text', () => {
  assert.equal(shouldRunOcrPreview(base), true);
  assert.equal(shouldRunOcrPreview({ ...base, visible_text: ['MINNESOTA GREY DUCK'] }), false);
  assert.equal(shouldRunOcrPreview({ ...base, category: 'furniture', subcategory: 'chair', distinctive_features: [] }), false);
});

test('merges only sufficiently confident OCR evidence', () => {
  const good = normalizeOcrEvidence({ visible_text: ['MINNESOTA GREY DUCK'], logos_markings: ['duck graphic'], confidence: 0.92 });
  assert.deepEqual(mergeOcrEvidence(base, good).visible_text, ['MINNESOTA GREY DUCK']);
  const weak = normalizeOcrEvidence({ visible_text: ['MINNES0TA'], confidence: 0.4 });
  assert.deepEqual(mergeOcrEvidence(base, weak).visible_text, []);
});
