import assert from 'node:assert/strict';
import test from 'node:test';
import { applyJevSemanticGate } from '../dist/src/jev-semantic-gate.js';
import { JevJudgmentProvider } from '../dist/src/jev.js';

const description = {
  category: 'accessories',
  subcategory: 'wristwatch',
  brand_candidate: 'CASIO',
  model_candidate: 'F-91W',
  color: 'black',
  material: 'resin',
  style_attributes: ['digital watch'],
  visible_text: ['CASIO', 'F-91W'],
  logos_markings: ['CASIO'],
  distinctive_features: ['rectangular digital display'],
  hardware_details: [],
  shape_silhouette: ['rectangular watch case'],
  search_terms: ['CASIO F-91W'],
  confidence: 0.95,
  identity_confidence: 0.96,
  evidence_confidence: { visible_text: 0.96, logos_markings: 0.96 },
};

const candidate = (id, title, metadata = {}) => ({
  id,
  title,
  brand: metadata.brand ?? null,
  model: metadata.model ?? null,
  category: metadata.category ?? 'Wristwatch',
  image_reference: 'https://example.com/watch.jpg',
  provenance: 'test',
  destination: null,
  price: null,
  currency: null,
  result_class: 'SIMILAR',
  metadata,
});

test('Jev semantic gate rejects only contradiction probability >= 0.98', async () => {
  const ai = {
    async run() {
      return {
        model: 'jev-1.13.0',
        answers: {
          candidate_0: { type: 'noul', noul: 0.995 },
          candidate_1: { type: 'noul', noul: 0.97 },
          candidate_2: { type: 'noul', noul: 0.05 },
        },
        usage: { input_tokens: 321, output_tokens: 20 },
      };
    },
  };

  const products = [
    candidate('0', 'OMEGA Seamaster', { brand: 'OMEGA', model: 'Seamaster' }),
    candidate('1', 'CASIO digital watch'),
    candidate('2', 'CASIO F-91W', { brand: 'CASIO', model: 'F-91W' }),
  ];

  const result = await applyJevSemanticGate(new JevJudgmentProvider(ai), description, products);

  assert.deepEqual(result.candidates.map((item) => item.id), ['1', '2']);
  assert.equal(result.telemetry.rejected, 1);
  assert.equal(result.telemetry.candidates_before, 3);
  assert.equal(result.telemetry.candidates_after, 2);
  assert.equal(result.telemetry.calls, 1);
  assert.equal(result.telemetry.input_tokens, 321);
  assert.equal(result.telemetry.output_tokens, 20);
  assert.equal(result.telemetry.failed, false);
});

test('Jev semantic gate fails open on service errors', async () => {
  const products = [
    candidate('0', 'OMEGA Seamaster', { brand: 'OMEGA' }),
    candidate('1', 'CASIO F-91W', { brand: 'CASIO', model: 'F-91W' }),
  ];
  const ai = { async run() { throw new Error('Workers AI unavailable'); } };

  const result = await applyJevSemanticGate(new JevJudgmentProvider(ai), description, products);

  assert.deepEqual(result.candidates.map((item) => item.id), ['0', '1']);
  assert.equal(result.telemetry.failed, true);
  assert.equal(result.telemetry.rejected, 0);
});

test('Jev semantic gate treats malformed or missing answers as uncertainty', async () => {
  const products = [
    candidate('0', 'CASIO F-91W'),
    candidate('1', 'Generic digital watch'),
  ];
  const ai = {
    async run() {
      return {
        answers: {
          candidate_0: { type: 'choice', choice: 'wrong-shape' },
        },
      };
    },
  };

  const result = await applyJevSemanticGate(new JevJudgmentProvider(ai), description, products);

  assert.deepEqual(result.candidates.map((item) => item.id), ['0', '1']);
  assert.equal(result.telemetry.rejected, 0);
});
