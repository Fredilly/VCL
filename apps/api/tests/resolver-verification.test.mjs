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

test('resolver verifies all retrieved images before limiting offers; stronger late candidate wins', async () => {
  const products = Array.from({ length: 12 }, (_, i) => ({ ...candidate, id: String(i), destination: `https://shop.example/${i}` }));
  let received = 0;
  const compare = async (...args) => {
    received += args[4].length;
    const result = await verifier(...args);
    for (const p of args[4]) if (p.id !== '11') result.comparisons.set(candidateKey(p), { ...comparison, similarity: 0.62 });
    return result;
  };
  const result = await resolveProducts([{ name: 'test', provider: { async search() { return products; } }, tier: 'primary' }], queries, description, env, undefined, source, compare);
  assert.equal(received, 12); assert.equal(result.products.length, 8); assert.equal(result.products[0].id, '11');
});

test('missing images keep credible type matches as SIMILAR without claiming verification', async () => {
  const unavailable = async () => ({ comparisons: new Map(), compared: 0, failures: 1 });
  const result = await resolveProducts([{ name: 'test', provider: { async search() { return [candidate]; } }, tier: 'primary' }], queries, description, env, undefined, source, unavailable);
  assert.equal(result.products[0].result_class, 'SIMILAR');
  assert.equal(result.products[0].verification_status, 'metadata_only');
  assert.equal(result.verification.image_failures, 1);
});

// ── Default routing scope tests ──

test('default routing: Etsy and Brave are not active in normal production flow', async () => {
  const providersUsed = [];
  const providers = [
    { name: 'ebay', provider: { async search() { providersUsed.push('ebay'); return [candidate]; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { providersUsed.push('serpapi'); return []; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env);
  assert.ok(providersUsed.includes('ebay'), 'eBay should be invoked');
  assert.ok(providersUsed.includes('serpapi'), 'SerpAPI should be invoked as fallback');
  assert.ok(!providersUsed.includes('etsy'), 'Etsy must not be in default routing');
  assert.ok(!providersUsed.includes('brave'), 'Brave must not be in default routing');
});

test('default routing via worker: only ebay and serpapi in providers_used', async () => {
  const invokedProviders = [];
  const worker = loadModule(file('server'), {
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('serpapi.com/account.json')) return Response.json({ total_searches_left: 100, plan_searches_left: 100 });
      if (u.includes('serpapi.com')) { invokedProviders.push('serpapi'); return Response.json({ shopping_results: [] }); }
      if (u.includes('ebay.com')) { invokedProviders.push('ebay'); return Response.json({ itemSummaries: [] }); }
      return new Response('[]', { headers: { 'content-type': 'image/png' } });
    },
    console: { error() {} },
  }).default;
  const response = await worker.fetch(new Request('https://api.vcl.article6.org/resolve-products', { method: 'POST',
    body: JSON.stringify({ description }) }), { SERPAPI_API_KEY: 'test', EBAY_SANDBOX_CLIENT_ID: 'id', EBAY_SANDBOX_CLIENT_SECRET: 'secret' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.providers_used.includes('ebay'), 'eBay should be in providers_used');
  assert.ok(result.providers_used.includes('serpapi'), 'SerpAPI should be in providers_used');
  assert.ok(!result.providers_used.includes('etsy'), 'Etsy must not be in providers_used');
  assert.ok(!result.providers_used.includes('brave'), 'Brave must not be in providers_used');
});

// ── SerpAPI skip-when-sufficient tests ──

test('SerpAPI skipped when primary providers return enough accepted candidates', async () => {
  let serpapiCalled = false;
  const providers = [
    { name: 'ebay', provider: { async search() {
      return [
        { ...candidate, id: 'e1', destination: 'https://shop.example/1' },
        { ...candidate, id: 'e2', destination: 'https://shop.example/2' },
        { ...candidate, id: 'e3', destination: 'https://shop.example/3' },
      ];
    } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { serpapiCalled = true; return [candidate]; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env, undefined, source, verifier);
  assert.equal(serpapiCalled, false, 'SerpAPI should not be called when primary returns 3+ accepted');
  assert.equal(result.serpapi.skipped, true);
  assert.equal(result.serpapi.skip_reason, 'upstream_sufficient');
});

test('rejected raw candidates do not suppress SerpAPI', async () => {
  let serpapiCalled = false;
  // Provider returns candidates with wrong type (dress vs T-shirt) so metadata verification rejects them.
  const wrongTypeCandidates = [
    { ...candidate, id: 'e1', title: 'Nike men black dress', destination: 'https://shop.example/1' },
    { ...candidate, id: 'e2', title: 'Nike men black dress', destination: 'https://shop.example/2' },
  ];
  const providers = [
    { name: 'ebay', provider: { async search() { return wrongTypeCandidates; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { serpapiCalled = true; return [{ ...candidate, id: 's1', destination: 'https://serpapi.example/1' }]; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env);
  assert.equal(serpapiCalled, true, 'SerpAPI should still be called because rejected candidates are not accepted');
  assert.equal(result.serpapi.invoked, true);
  assert.ok(result.verification.rejected >= 1, 'raw candidates should be rejected but not count toward sufficiency');
});

test('SerpAPI invoked when primary returns fewer than threshold accepted', async () => {
  let serpapiCalled = false;
  const providers = [
    { name: 'ebay', provider: { async search() {
      return [{ ...candidate, id: 'e1', destination: 'https://shop.example/1' }];
    } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { serpapiCalled = true; return [{ ...candidate, id: 's1', destination: 'https://serpapi.example/1' }]; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env, undefined, source, verifier);
  assert.equal(serpapiCalled, true, 'SerpAPI should be called when primary has < 3 accepted');
  assert.equal(result.serpapi.invoked, true);
});

// ── SerpAPI telemetry isolation tests ──

test('SerpAPI telemetry reflects only SerpAPI activity', async () => {
  const providers = [
    { name: 'ebay', provider: { async search() { return []; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { return [{ ...candidate, id: 's1', destination: 'https://serpapi.example/1' }]; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env, undefined, source, verifier);
  assert.equal(result.serpapi.invoked, true);
  assert.equal(result.serpapi.success, true);
  assert.equal(result.serpapi.skipped, false);
  assert.equal(result.serpapi.timeout_or_failure, false);
  assert.equal(result.serpapi.quota_exhausted, false);
});

test('SerpAPI telemetry: skipped when quota exhausted at adapter level', async () => {
  const providers = [
    { name: 'ebay', provider: { async search() {
      return [
        { ...candidate, id: 'e1', destination: 'https://shop.example/1' },
        { ...candidate, id: 'e2', destination: 'https://shop.example/2' },
        { ...candidate, id: 'e3', destination: 'https://shop.example/3' },
      ];
    } }, tier: 'primary' },
    { name: 'serpapi', provider: {
      async search() { throw new Error('SerpAPI quota exhausted — skipping.'); },
      getQuotaInfo() { return { total_searches_left: 0 }; },
      isQuotaExhausted() { return true; },
    }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env, undefined, source, verifier);
  // SerpAPI should be skipped because primary returned sufficient accepted
  assert.equal(result.serpapi.skipped, true);
  assert.equal(result.serpapi.skip_reason, 'upstream_sufficient');
});

test('SerpAPI telemetry is the only provider telemetry in response', async () => {
  const providers = [
    { name: 'serpapi', provider: { async search() { return [{ ...candidate, id: 's1', destination: 'https://serpapi.example/1' }]; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env, undefined, source, verifier);
  assert.ok(result.serpapi, 'response must include serpapi telemetry');
  assert.equal(result.serpapi.invoked, true);
  assert.equal(result.serpapi.success, true);
  assert.equal(typeof result.serpapi.skipped, 'boolean');
  assert.equal(typeof result.serpapi.no_result, 'boolean');
  assert.equal(typeof result.serpapi.timeout_or_failure, 'boolean');
  assert.equal(typeof result.serpapi.quota_exhausted, 'boolean');
});
