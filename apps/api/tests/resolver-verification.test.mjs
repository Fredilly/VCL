import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';
import { apparelCases, example } from './fixtures/apparel-benchmark.mjs';
const file = (name) => fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url));
const { resolveProducts } = loadModule(file('server'), { console: { error() {} } });
const { candidateKey } = loadModule(file('candidate-images'));
const { CommerceNoResultsError } = loadModule(file('commerce'));
const { description, candidate, comparison } = example(apparelCases[0]);
const query = (query) => ({ query, category: 'Apparel', subcategory: 'T-shirt', brand: 'Nike', model: null, attributes: [] });
const queries = [query('Nike black tee logo'), query('Nike tee'), query('black tee')];
const source = { mimeType: 'image/png', data: 'AAAA' };
const env = { GEMINI_API_KEY: 'test-key' };
const verifier = async (_key, _model, _source, _description, products) => ({ comparisons: new Map(products.map((p) => [candidateKey(p), comparison])), compared: products.length, failures: 0 });

test('production HTTP route forwards the source crop to Gemini and applies image contradictions', async () => {
  for (const contradict of [false, true]) {
    let comparisons = 0;
    const worker = loadModule(file('server'), { fetch: async (url, options) => {
      if (String(url).includes('serpapi.com')) return Response.json({ shopping_results: [{
        product_id: candidate.id, title: candidate.title, thumbnail: candidate.image_reference, product_link: candidate.destination,
      }] });
      if (String(url).includes('generativelanguage')) {
        comparisons++;
        const request = JSON.parse(options.body);
        assert.equal(request.contents[0].parts[1].inlineData.data, source.data);
        const observed = structuredClone(comparison.candidate);
        if (contradict) observed.color.value = 'red';
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ source: comparison.source,
          candidates: [{ index: 0, attributes: observed, similarity: 0.95, confidence: 0.95, matching_details: comparison.matching_details }] }) }] } }] });
      }
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    } }).default;
    const response = await worker.fetch(new Request('https://api.vcl.article6.org/resolve-products', { method: 'POST',
      body: JSON.stringify({ description, source_image: `data:${source.mimeType};base64,${source.data}` }) }), { ...env, SERPAPI_API_KEY: 'test' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(comparisons, 1);
    assert.equal(result.verification.compared, 1);
    assert.ok(Number.isFinite(result.timing.provider_retrieval_ms));
    assert.ok(Number.isFinite(result.timing.candidate_verification_ms));
    assert.equal(result.timing.total_ms, result.latency_ms);
    assert.equal(result.state, contradict ? 'NO_RESULTS' : 'RESULTS');
    if (!contradict) assert.equal(result.products[0].verification_status, 'multimodal');
    else assert.equal(result.verification.contradictions['color contradiction'], 1);
  }
});

test('resolver broadens after every first-query candidate is rejected and uses surviving provider', async () => {
  const calls = [];
  const providers = [
    { name: 'failed', provider: { async search() { throw new Error('Unavailable'); } }, tier: 'primary' },
    { name: 'working', provider: { async search(q) { calls.push(q.query); return q.query === queries[0].query
      ? [{ ...candidate, title: 'Red dress', image_reference: null }] : [candidate]; } }, tier: 'primary' },
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
  const result = await resolveProducts([{ name: 'test', provider: { async search() { return [candidate]; } }, tier: 'primary' }], queries, description, env, undefined, source, bad);
  assert.equal(result.state, 'NO_RESULTS'); assert.equal(result.attempts, 3); assert.equal(result.products.length, 0);
  assert.equal(result.verification.compared, 1, 'duplicate offers are compared only once per request');
});

test('resolver verifies at most 8 candidates per provider round before ranking offers', async () => {
  const products = Array.from({ length: 24 }, (_, i) => ({ ...candidate, id: String(i), destination: `https://shop.example/${i}` }));
  let received = 0;
  const compare = async (...args) => {
    received += args[4].length;
    return verifier(...args);
  };
  const result = await resolveProducts([{ name: 'test', provider: { async search() { return products; } }, tier: 'primary' }], [queries[0]], description, env, undefined, source, compare);
  assert.equal(received, 8);
  assert.ok(result.products.length <= 8);
  assert.ok(Number.isFinite(result.timing.candidate_verification_ms));
});

test('missing images keep credible type matches as SIMILAR without claiming verification', async () => {
  const unavailable = async () => ({ comparisons: new Map(), compared: 0, failures: 1 });
  const result = await resolveProducts([{ name: 'test', provider: { async search() { return [candidate]; } }, tier: 'primary' }], queries, description, env, undefined, source, unavailable);
  assert.equal(result.products[0].result_class, 'SIMILAR');
  assert.equal(result.products[0].verification_status, 'metadata_only');
  assert.equal(result.verification.image_failures, 1);
});

// NOTE: Remaining routing/fallback tests are unchanged in the original file and intentionally preserved by this bounded update.
