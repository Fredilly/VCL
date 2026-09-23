import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const {
  applyFeedbackPenalties,
  evidenceFingerprint,
  feedbackCandidateKey,
} = loadModule(new URL('../src/feedback-ledger.ts', import.meta.url).pathname);

function candidate(id, score = 80, result_class = 'LIKELY') {
  return {
    id,
    title: id,
    brand: null,
    model: null,
    category: 'apparel',
    image_reference: null,
    provenance: 'brave',
    provider: 'brave',
    destination: `https://example.com/${id}`,
    price: null,
    currency: null,
    result_class,
    verification_score: score,
    identity_key: `brave:${id}`,
    verification_reasons: ['visual agreement'],
  };
}

const description = {
  category: 'apparel',
  subcategory: 't-shirt',
  brand_candidate: 'Example',
  model_candidate: null,
  color: 'white',
  material: 'cotton',
  style_attributes: [],
  search_terms: [],
  confidence: 0.9,
  identity_confidence: 0.8,
  visible_text: ['MINNESOTA'],
  logos_markings: [],
  distinctive_features: ['navy collegiate lettering'],
  shape_silhouette: [],
  evidence_confidence: {},
};

test('one comparable wrong correction only demotes and never strengthens identity class', () => {
  const a = candidate('a', 80, 'LIKELY');
  const b = candidate('b', 70, 'SIMILAR');
  const penalties = new Map([
    [feedbackCandidateKey(a), { candidate_key: feedbackCandidateKey(a), wrong_count: 1, correct_count: 0 }],
  ]);

  const result = applyFeedbackPenalties([a, b], penalties);
  const adjusted = result.products.find((product) => product.id === 'a');

  assert.equal(result.penalized, 1);
  assert.equal(result.suppressed, 0);
  assert.equal(adjusted.verification_score, 60);
  assert.equal(adjusted.result_class, 'LIKELY');
  assert.match(adjusted.verification_reasons.at(-1), /prior comparable user correction/);
});

test('repeated comparable wrong corrections suppress a known-bad mapping', () => {
  const a = candidate('a');
  const penalties = new Map([
    [feedbackCandidateKey(a), { candidate_key: feedbackCandidateKey(a), wrong_count: 2, correct_count: 0 }],
  ]);

  const result = applyFeedbackPenalties([a], penalties);
  assert.equal(result.suppressed, 1);
  assert.deepEqual(result.products, []);
});

test('positive feedback can cancel a negative penalty but never boosts the verification score', () => {
  const a = candidate('a', 72, 'SIMILAR');
  const penalties = new Map([
    [feedbackCandidateKey(a), { candidate_key: feedbackCandidateKey(a), wrong_count: 1, correct_count: 1 }],
  ]);

  const result = applyFeedbackPenalties([a], penalties);
  assert.equal(result.penalized, 0);
  assert.equal(result.products[0].verification_score, 72);
  assert.equal(result.products[0].result_class, 'SIMILAR');
});

test('evidence fingerprint is deterministic and changes with derived object evidence', () => {
  const first = evidenceFingerprint(description);
  const second = evidenceFingerprint({ ...description });
  const changed = evidenceFingerprint({ ...description, visible_text: ['WISCONSIN'] });

  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{16}$/);
});
