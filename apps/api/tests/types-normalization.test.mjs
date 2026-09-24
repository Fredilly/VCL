import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeObjectDescription } from '../dist/src/types.js';

test('empty visible_text cannot claim high visible-text confidence', () => {
  const normalized = normalizeObjectDescription({
    category: 'Sportswear',
    subcategory: 'Basketball Jersey',
    brand_candidate: null,
    model_candidate: null,
    color: 'Red',
    material: '',
    style_attributes: [],
    visible_text: [],
    logos_markings: [],
    distinctive_features: [],
    hardware_details: [],
    shape_silhouette: [],
    search_terms: ['Basketball Jersey', 'Red Jersey', 'Jersey 7'],
    confidence: 0.9,
    identity_confidence: 0.1,
    evidence_confidence: { visible_text: 0.9, category: 0.9 },
  });
  assert.deepEqual(normalized.visible_text, []);
  assert.equal(normalized.evidence_confidence.visible_text, 0);
  assert.equal(normalized.evidence_confidence.category, 0.9);
});
