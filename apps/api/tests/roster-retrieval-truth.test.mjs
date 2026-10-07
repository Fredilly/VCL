import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const fallback = loadModule(new URL('../src/roster-fallback.ts', import.meta.url).pathname);
const commerce = loadModule(new URL('../src/commerce.ts', import.meta.url).pathname);
const seeds = loadModule(new URL('../src/alpha-verified-product-seeds.ts', import.meta.url).pathname);

const description = (overrides = {}) => ({
  category: 'Bags',
  subcategory: 'Vanity Case',
  brand_candidate: 'Louis Vuitton',
  model_candidate: 'Cannes',
  color: 'White',
  material: 'Leather',
  style_attributes: ['Monogram', 'Structured'],
  visible_text: [],
  contextual_text: [],
  logos_markings: ['LV monogram pattern', 'LV logo on lock'],
  distinctive_features: ['All-over monogram pattern in light blue'],
  hardware_details: ['Gold-tone padlock'],
  shape_silhouette: [],
  search_terms: ['Louis Vuitton Cannes Vanity Case', 'White LV Monogram Vanity Case'],
  confidence: 0.9,
  identity_confidence: 0.9,
  evidence_confidence: { model_candidate: 0.8, contextual_text: 0, visible_text: 0 },
  ...overrides,
});

test('roster miss separates retrieval hypothesis from identity proof', () => {
  const source = description();
  const safe = fallback.rosterFallbackDescription(source);
  const retrieval = fallback.rosterFallbackRetrievalDescription(source);

  assert.equal(safe.model_candidate, null, 'ungrounded model guess must not verify identity');
  assert.equal(retrieval.model_candidate, 'Cannes', 'family guess may still nominate a bounded search');
  assert.equal(retrieval.identity_confidence, 0, 'retrieval hypothesis must not regain identity authority');

  const queries = commerce.buildProductQueryVariants(retrieval);
  assert.ok(queries.some((row) => /Cannes/i.test(row.query)));
  assert.ok(queries.some((row) => /Vanity Case/i.test(row.query)));
  assert.ok(queries.every((row) => !/^bag White$/i.test(row.query)));
});

test('red Speedy retrieval keeps the specific subtype and family hypothesis', () => {
  const source = description({
    subcategory: 'Handbag',
    model_candidate: 'Speedy',
    color: 'Red',
    material: 'Canvas',
    distinctive_features: ['Red monogram canvas', 'Tan leather luggage tag'],
    hardware_details: ['Padlock'],
    search_terms: ['Louis Vuitton Speedy Red Monogram Handbag'],
  });
  const retrieval = fallback.rosterFallbackRetrievalDescription(source);
  const queries = commerce.buildProductQueryVariants(retrieval);
  assert.ok(queries.some((row) => /Louis Vuitton.*Speedy/i.test(row.query)));
  assert.ok(queries.some((row) => /Handbag/i.test(row.query)));
});

test('Handbagholic roster includes the Milky White vanity and supplied red P9 variant at their frames', () => {
  const white = seeds.alphaVerifiedCanonicalRowsForContent('youtube', 'n9u8ynhBdSo', 739808);
  assert.ok(white.some((row) => row.mapping.product_id === 'M27744'));

  const red = seeds.alphaVerifiedCanonicalRowsForContent('youtube', 'n9u8ynhBdSo', 836786);
  assert.ok(red.some((row) => row.mapping.product_id === 'FP-1961012'));
});
