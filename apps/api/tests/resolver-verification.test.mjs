import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';
import { apparelCases, example } from './fixtures/apparel-benchmark.mjs';
const file = (name) => fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url));
const { resolveProducts } = loadModule(file('server'), { console: { error() {} } });
const { candidateKey } = loadModule(file('candidate-images'));
const { description, candidate, comparison } = example(apparelCases[0]);
const query = (query) => ({ query, category: 'Apparel', subcategory: 'T-shirt', brand: 'Nike', model: null, attributes: [] });
const queries = [query('Nike black tee logo'), query('Nike tee'), query('black tee')];
const source = { mimeType: 'image/png', data: 'AAAA' };
const env = { GEMINI_API_KEY: 'test-key' };
const verifier = async (_key, _model, _source, _description, products) => ({ comparisons: new Map(products.map((p) => [candidateKey(p), comparison])), compared: products.length, failures: 0 });

test('resolver broadens after every first-query candidate is rejected and uses surviving provider', async () => {
  const calls = [];
  const providers = [
    { name: 'failed', provider: { async search() { throw new Error('Unavailable'); } } },
    { name: 'working', provider: { async search(q) { calls.push(q.query); return q.query === queries[0].query
      ? [{ ...candidate, title: 'Red dress', image_reference: null }] : [candidate]; } } },
  ];
  const result = await resolveProducts(providers, queries, description, {});
  assert.equal(result.state, 'RESULTS'); assert.equal(result.attempts, 3);
  assert.equal(result.products.length, 1); assert.equal(calls.length, 3);
  assert.equal(result.verification.rejected, 1);
});

test('all candidates rejected by images returns NO_RESULTS after broadening', async () => {
  const bad = async (...args) => {
    const result = await verifier(...args);
    for (const [key, value] of result.comparisons) result.comparisons.set(key, { ...value, candidate: { ...value.candidate, color: { value: 'red', confidence: 0.99, basis: 'image' } } });
    return result;
  };
  const result = await resolveProducts([{ name: 'test', provider: { async search() { return [candidate]; } } }], queries, description, env, undefined, source, bad);
  assert.equal(result.state, 'NO_RESULTS'); assert.equal(result.attempts, 3); assert.equal(result.products.length, 0);
  assert.equal(result.verification.compared, 1, 'duplicate offers are compared only once per request');
});

test('resolver verifies all retrieved images before limiting offers; stronger late candidate wins', async () => {
  const products = Array.from({ length: 12 }, (_, i) => ({ ...candidate, id: String(i), destination: `https://shop.example/${i}` }));
  let received = 0;
  const compare = async (...args) => {
    received += args[4].length;
    const result = await verifier(...args);
    for (const p of args[4]) if (p.id !== '11') result.comparisons.set(candidateKey(p), { ...comparison, similarity: 0.62 });
    return result;
  };
  const result = await resolveProducts([{ name: 'test', provider: { async search() { return products; } } }], queries, description, env, undefined, source, compare);
  assert.equal(received, 12); assert.equal(result.products.length, 8); assert.equal(result.products[0].id, '11');
});

test('missing images keep credible type matches as SIMILAR without claiming verification', async () => {
  const unavailable = async () => ({ comparisons: new Map(), compared: 0, failures: 1 });
  const result = await resolveProducts([{ name: 'test', provider: { async search() { return [candidate]; } } }], queries, description, env, undefined, source, unavailable);
  assert.equal(result.products[0].result_class, 'SIMILAR');
  assert.equal(result.products[0].verification_status, 'metadata_only');
  assert.equal(result.verification.image_failures, 1);
});
