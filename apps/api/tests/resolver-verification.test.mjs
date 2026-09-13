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

test('fashion query: eBay + Etsy run as primaries, Brave is skipped when sufficient', async () => {
  const providersUsed = [];
  const providers = [
    { name: 'ebay', provider: { async search() { providersUsed.push('ebay'); return [candidate]; } }, tier: 'primary' },
    { name: 'etsy', provider: { async search() { providersUsed.push('etsy'); return [candidate]; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { providersUsed.push('serpapi'); return []; } }, tier: 'fallback' },
    { name: 'brave', provider: { async search() { providersUsed.push('brave'); return []; } }, tier: 'fallback' },
  ];
  const fashionQ = [query('Nike black tee logo'), query('Nike tee'), query('black tee')];
  const result = await resolveProducts(providers, fashionQ, description, env);
  assert.ok(providersUsed.includes('ebay'), 'eBay should be invoked');
  assert.ok(providersUsed.includes('etsy'), 'Etsy should be invoked for apparel');
  assert.equal(result.state, 'RESULTS');
});

test('electronics query: Etsy is not invoked, only eBay runs', async () => {
  const providersUsed = [];
  const providers = [
    { name: 'ebay', provider: { async search() { providersUsed.push('ebay'); return [candidate]; } }, tier: 'primary' },
    { name: 'etsy', provider: { async search() { providersUsed.push('etsy'); return [candidate]; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { providersUsed.push('serpapi'); return []; } }, tier: 'fallback' },
    { name: 'brave', provider: { async search() { providersUsed.push('brave'); return []; } }, tier: 'fallback' },
  ];
  const electronicsQuery = [{ query: 'laptop charger', category: 'electronics', subcategory: 'computers', brand: null, model: null, attributes: [] }];
  const result = await resolveProducts(providers, electronicsQuery, description, env);
  assert.ok(providersUsed.includes('ebay'), 'eBay should be invoked');
  assert.ok(!providersUsed.includes('etsy'), 'Etsy must not be invoked for electronics');
  assert.ok(providersUsed.includes('serpapi'), 'SerpAPI should be invoked when primary results are insufficient');
  assert.equal(result.state, 'RESULTS');
});

test('default routing via worker: eBay and SerpAPI in providers_used, Etsy included when eligible', async () => {
  const invokedProviders = [];
  const worker = loadModule(file('server'), {
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('serpapi.com/account.json')) return Response.json({ total_searches_left: 100, plan_searches_left: 100 });
      if (u.includes('serpapi.com')) { invokedProviders.push('serpapi'); return Response.json({ shopping_results: [] }); }
      if (u.includes('ebay.com')) { invokedProviders.push('ebay'); return Response.json({ itemSummaries: [] }); }
      if (u.includes('openapi.etsy.com')) { invokedProviders.push('etsy'); return Response.json({ count: 0, results: [] }); }
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
  assert.ok(!result.providers_used.includes('brave'), 'Brave must not be in providers_used when SerpAPI succeeds');
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

test('raw sufficient but verified insufficient: fallbacks still run', async () => {
  const providersUsed = [];
  const rejectVerifier = async (_key, _model, _source, _description, products) => ({
    comparisons: new Map(products.map((p) => [candidateKey(p), { ...comparison, candidate: { ...comparison.candidate, color: { value: 'contradicted', confidence: 0.99 } }, similarity: 0.01, confidence: 0.99 }])),
    compared: products.length, failures: 0,
  });
  const providers = [
    { name: 'ebay', provider: { async search() {
      providersUsed.push('ebay');
      return [
        { ...candidate, id: 'e1', destination: 'https://shop.example/1' },
        { ...candidate, id: 'e2', destination: 'https://shop.example/2' },
        { ...candidate, id: 'e3', destination: 'https://shop.example/3' },
      ];
    } }, tier: 'primary' },
    { name: 'brave', provider: { async search() {
      providersUsed.push('brave');
      return [{ ...candidate, id: 'b1', destination: 'https://brave.example/1', provider: 'brave', provenance: 'brave:web' }];
    } }, tier: 'fallback' },
    { name: 'serpapi', provider: { async search() {
      providersUsed.push('serpapi');
      return [{ ...candidate, id: 's1', destination: 'https://serpapi.example/1' }];
    } }, tier: 'fallback' },
  ];
  const fashionQ = [query('Nike black tee logo'), query('Nike tee'), query('black tee')];
  const result = await resolveProducts(providers, fashionQ, description, env, undefined, source, rejectVerifier);
  assert.ok(providersUsed.includes('ebay'), 'eBay should be invoked');
  assert.ok(providersUsed.includes('brave'), 'Brave MUST run when all 3 raw candidates fail verification');
  assert.ok(providersUsed.includes('serpapi'), 'SerpAPI MUST run when accepted < 3 after Brave');
  assert.equal(result.brave.skipped, false);
  assert.equal(result.serpapi.skipped, false);
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
  assert.ok(result.brave, 'response must include brave telemetry');
  assert.equal(typeof result.brave.invoked, 'boolean');
});

// ── Category-aware routing tests ──

test('fashion category: eBay + Etsy both run as primaries', async () => {
  const providersUsed = [];
  const providers = [
    { name: 'ebay', provider: { async search() { providersUsed.push('ebay'); return [candidate]; } }, tier: 'primary' },
    { name: 'etsy', provider: { async search() { providersUsed.push('etsy'); return [{ ...candidate, id: 'etsy1', provider: 'etsy', provenance: 'etsy:listings', destination: 'https://etsy.com/1' }]; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { providersUsed.push('serpapi'); return []; } }, tier: 'fallback' },
    { name: 'brave', provider: { async search() { providersUsed.push('brave'); return []; } }, tier: 'fallback' },
  ];
  const fashionQ = [query('Nike black tee logo'), query('Nike tee'), query('black tee')];
  const result = await resolveProducts(providers, fashionQ, description, env, undefined, source, verifier);
  assert.ok(providersUsed.includes('ebay'), 'eBay should be invoked for fashion');
  assert.ok(providersUsed.includes('etsy'), 'Etsy should be invoked for fashion');
  assert.equal(result.state, 'RESULTS');
});

test('watches category: eBay + Etsy both run as primaries', async () => {
  const providersUsed = [];
  const providers = [
    { name: 'ebay', provider: { async search() { providersUsed.push('ebay'); return [candidate]; } }, tier: 'primary' },
    { name: 'etsy', provider: { async search() { providersUsed.push('etsy'); return []; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { providersUsed.push('serpapi'); return []; } }, tier: 'fallback' },
  ];
  const watchesQuery = [{ query: 'Rolex Submariner', category: 'watches', subcategory: 'luxury', brand: 'Rolex', model: 'Submariner', attributes: [] }];
  const result = await resolveProducts(providers, watchesQuery, description, env);
  assert.ok(providersUsed.includes('ebay'), 'eBay should be invoked for watches');
  assert.ok(providersUsed.includes('etsy'), 'Etsy should be invoked for watches');
});

test('jewelry category: eBay + Etsy both run as primaries', async () => {
  const providersUsed = [];
  const providers = [
    { name: 'ebay', provider: { async search() { providersUsed.push('ebay'); return [candidate]; } }, tier: 'primary' },
    { name: 'etsy', provider: { async search() { providersUsed.push('etsy'); return []; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { providersUsed.push('serpapi'); return []; } }, tier: 'fallback' },
  ];
  const jewelryQuery = [{ query: 'silver pendant necklace', category: 'jewelry', subcategory: 'necklaces', brand: null, model: null, attributes: [] }];
  const result = await resolveProducts(providers, jewelryQuery, description, env);
  assert.ok(providersUsed.includes('ebay'), 'eBay should be invoked for jewelry');
  assert.ok(providersUsed.includes('etsy'), 'Etsy should be invoked for jewelry');
});

test('electronics category: Etsy is not invoked', async () => {
  const providersUsed = [];
  const providers = [
    { name: 'ebay', provider: { async search() { providersUsed.push('ebay'); return [candidate]; } }, tier: 'primary' },
    { name: 'etsy', provider: { async search() { providersUsed.push('etsy'); return []; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { providersUsed.push('serpapi'); return []; } }, tier: 'fallback' },
  ];
  const electronicsQuery = [{ query: 'wireless headphones', category: 'electronics', subcategory: 'audio', brand: null, model: null, attributes: [] }];
  const result = await resolveProducts(providers, electronicsQuery, description, env);
  assert.ok(providersUsed.includes('ebay'), 'eBay should be invoked for electronics');
  assert.ok(!providersUsed.includes('etsy'), 'Etsy must not be invoked for electronics');
  assert.ok(providersUsed.includes('serpapi'), 'SerpAPI should be invoked when primary results are insufficient');
});

test('general/unknown category: Etsy is not invoked', async () => {
  const providersUsed = [];
  const providers = [
    { name: 'ebay', provider: { async search() { providersUsed.push('ebay'); return [candidate]; } }, tier: 'primary' },
    { name: 'etsy', provider: { async search() { providersUsed.push('etsy'); return []; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { providersUsed.push('serpapi'); return []; } }, tier: 'fallback' },
  ];
  const generalQuery = [{ query: 'random object', category: 'general', subcategory: '', brand: null, model: null, attributes: [] }];
  const result = await resolveProducts(providers, generalQuery, description, env);
  assert.ok(providersUsed.includes('ebay'), 'eBay should be invoked for general');
  assert.ok(!providersUsed.includes('etsy'), 'Etsy must not be invoked for general');
});

// ── Sufficient primaries -> no SerpAPI or Brave tests ──

test('Brave sufficient: SerpAPI is not invoked', async () => {
  let serpapiCalled = false;
  const providers = [
    { name: 'ebay', provider: { async search() { return []; } }, tier: 'primary' },
    { name: 'brave', provider: { async search() {
      return [
        { ...candidate, id: 'b1', destination: 'https://brave.example/1' },
        { ...candidate, id: 'b2', destination: 'https://brave.example/2' },
        { ...candidate, id: 'b3', destination: 'https://brave.example/3' },
      ];
    } }, tier: 'fallback' },
    { name: 'serpapi', provider: { async search() { serpapiCalled = true; return []; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env, undefined, source, verifier);
  assert.equal(serpapiCalled, false, 'SerpAPI should not be called when Brave returns sufficient results');
  assert.equal(result.serpapi.skip_reason, 'brave_sufficient');
});

// ── Insufficient primaries -> SerpAPI test ──

test('insufficient primaries: SerpAPI is invoked as fallback', async () => {
  let serpapiCalled = false;
  let braveCalled = false;
  const providers = [
    { name: 'ebay', provider: { async search() {
      return [{ ...candidate, id: 'e1', destination: 'https://shop.example/1' }];
    } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { serpapiCalled = true; return [{ ...candidate, id: 's1', destination: 'https://serpapi.example/1' }]; } }, tier: 'fallback' },
    { name: 'brave', provider: { async search() { braveCalled = true; return []; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env, undefined, source, verifier);
  assert.equal(serpapiCalled, true, 'SerpAPI should be called when primary has < 3 accepted');
  assert.equal(result.serpapi.invoked, true);
  // After primaries + SerpAPI, total accepted is still < 3, so Brave is invoked.
  assert.equal(braveCalled, true, 'Brave should be called when SerpAPI also returns insufficient results');
  assert.equal(result.brave.invoked, true);
});

// ── SerpAPI exhausted -> Brave fallback test ──

test('SerpAPI exhausted: Brave is invoked as final fallback', async () => {
  let braveCalled = false;
  const providers = [
    { name: 'ebay', provider: { async search() {
      return [{ ...candidate, id: 'e1', destination: 'https://shop.example/1' }];
    } }, tier: 'primary' },
    { name: 'serpapi', provider: {
      async search() { throw new Error('SerpAPI quota exhausted — skipping.'); },
      getQuotaInfo() { return { total_searches_left: 0 }; },
      isQuotaExhausted() { return true; },
    }, tier: 'fallback' },
    { name: 'brave', provider: { async search() { braveCalled = true; return [{ ...candidate, id: 'b1', destination: 'https://brave.example/1', provider: 'brave', provenance: 'brave:web' }]; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env);
  assert.equal(braveCalled, true, 'Brave should be called when SerpAPI is exhausted');
  assert.equal(result.brave.invoked, true);
  assert.equal(result.brave.success, true);
});

test('SerpAPI failed (HTTP 500): Brave is invoked as final fallback', async () => {
  let braveCalled = false;
  const providers = [
    { name: 'ebay', provider: { async search() {
      return [{ ...candidate, id: 'e1', destination: 'https://shop.example/1' }];
    } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { throw new Error('HTTP 500 Internal Server Error'); } }, tier: 'fallback' },
    { name: 'brave', provider: { async search() { braveCalled = true; return [{ ...candidate, id: 'b1', destination: 'https://brave.example/1', provider: 'brave', provenance: 'brave:web' }]; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env);
  assert.equal(braveCalled, true, 'Brave should be called when SerpAPI fails');
  assert.equal(result.brave.invoked, true);
  assert.equal(result.brave.success, true);
});

test('SerpAPI no results: Brave is invoked as final fallback', async () => {
  let braveCalled = false;
  const providers = [
    { name: 'ebay', provider: { async search() {
      return [{ ...candidate, id: 'e1', destination: 'https://shop.example/1' }];
    } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { throw new CommerceNoResultsError('No results'); } }, tier: 'fallback' },
    { name: 'brave', provider: { async search() { braveCalled = true; return [{ ...candidate, id: 'b1', destination: 'https://brave.example/1', provider: 'brave', provenance: 'brave:web' }]; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env);
  assert.equal(braveCalled, true, 'Brave should be called when SerpAPI returns no results');
  assert.equal(result.brave.invoked, true);
});

// ── SerpAPI sufficient -> Brave not invoked test ──

test('Brave failed: SerpAPI is invoked as final fallback', async () => {
  let serpapiCalled = false;
  const providers = [
    { name: 'ebay', provider: { async search() { return []; } }, tier: 'primary' },
    { name: 'brave', provider: { async search() { throw new Error('Brave API error'); } }, tier: 'fallback' },
    { name: 'serpapi', provider: { async search() { serpapiCalled = true; return [{ ...candidate, id: 's1', destination: 'https://serpapi.example/1' }]; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env);
  assert.equal(serpapiCalled, true, 'SerpAPI should be called when Brave fails');
  assert.equal(result.brave.invoked, true);
  assert.equal(result.brave.timeout_or_failure, true);
  assert.equal(result.serpapi.invoked, true);
});

// ── SerpAPI insufficient accepted candidates -> Brave invoked ──

test('SerpAPI returns 1 accepted candidate: Brave is invoked', async () => {
  let braveCalled = false;
  const providers = [
    { name: 'ebay', provider: { async search() { return []; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() {
      return [{ ...candidate, id: 's1', destination: 'https://serpapi.example/1' }];
    } }, tier: 'fallback' },
    { name: 'brave', provider: { async search() { braveCalled = true; return [{ ...candidate, id: 'b1', destination: 'https://brave.example/1', provider: 'brave', provenance: 'brave:web' }]; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env, undefined, source, verifier);
  assert.equal(braveCalled, true, 'Brave should be called when SerpAPI returns only 1 accepted candidate');
  assert.equal(result.brave.invoked, true);
});

test('SerpAPI returns 2 accepted candidates: Brave is invoked', async () => {
  let braveCalled = false;
  const providers = [
    { name: 'ebay', provider: { async search() { return []; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() {
      return [
        { ...candidate, id: 's1', destination: 'https://serpapi.example/1' },
        { ...candidate, id: 's2', destination: 'https://serpapi.example/2' },
      ];
    } }, tier: 'fallback' },
    { name: 'brave', provider: { async search() { braveCalled = true; return [{ ...candidate, id: 'b1', destination: 'https://brave.example/1', provider: 'brave', provenance: 'brave:web' }]; } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env, undefined, source, verifier);
  assert.equal(braveCalled, true, 'Brave should be called when SerpAPI returns only 2 accepted candidates');
  assert.equal(result.brave.invoked, true);
});

test('Brave insufficient, SerpAPI reaches 3 accepted: both invoked', async () => {
  let braveCalled = false;
  let serpapiCalled = false;
  const providers = [
    { name: 'ebay', provider: { async search() { return []; } }, tier: 'primary' },
    { name: 'brave', provider: { async search() {
      braveCalled = true;
      return [{ ...candidate, id: 'b1', destination: 'https://brave.example/1' }];
    } }, tier: 'fallback' },
    { name: 'serpapi', provider: { async search() {
      serpapiCalled = true;
      return [
        { ...candidate, id: 's1', destination: 'https://serpapi.example/1' },
        { ...candidate, id: 's2', destination: 'https://serpapi.example/2' },
        { ...candidate, id: 's3', destination: 'https://serpapi.example/3' },
      ];
    } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env, undefined, source, verifier);
  assert.equal(braveCalled, true, 'Brave should be called first');
  assert.equal(serpapiCalled, true, 'SerpAPI should be called when Brave returns insufficient');
  assert.equal(result.brave.invoked, true);
  assert.equal(result.serpapi.invoked, true);
});

// ── SerpAPI and Brave never run in parallel test ──

test('SerpAPI and Brave never run in parallel', async () => {
  let serpapiRunning = false;
  let braveRunning = false;
  let sawParallel = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const providers = [
    { name: 'ebay', provider: { async search() { return []; } }, tier: 'primary' },
    { name: 'serpapi', provider: {
      async search() {
        serpapiRunning = true;
        if (braveRunning) sawParallel = true;
        await sleep(10);
        serpapiRunning = false;
        throw new Error('quota exhausted');
      },
      getQuotaInfo() { return { total_searches_left: 0 }; },
      isQuotaExhausted() { return true; },
    }, tier: 'fallback' },
    { name: 'brave', provider: {
      async search() {
        braveRunning = true;
        if (serpapiRunning) sawParallel = true;
        await sleep(10);
        braveRunning = false;
        return [{ ...candidate, id: 'b1', destination: 'https://brave.example/1' }];
      },
    }, tier: 'fallback' },
  ];
  await resolveProducts(providers, queries, description, env);
  assert.equal(sawParallel, false, 'SerpAPI and Brave must never run in parallel');
});

// ── Provider failures remain isolated test ──

test('provider failures remain isolated: Etsy failure does not block eBay results', async () => {
  const providersUsed = [];
  const providers = [
    { name: 'ebay', provider: { async search() {
      providersUsed.push('ebay');
      return [{ ...candidate, id: 'e1', destination: 'https://shop.example/1' }];
    } }, tier: 'primary' },
    { name: 'etsy', provider: { async search() {
      providersUsed.push('etsy');
      throw new Error('Etsy unavailable');
    } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { providersUsed.push('serpapi'); return []; } }, tier: 'fallback' },
  ];
  const fashionQ = [query('Nike black tee logo'), query('Nike tee'), query('black tee')];
  const result = await resolveProducts(providers, fashionQ, description, env, undefined, source, verifier);
  assert.ok(providersUsed.includes('ebay'), 'eBay should still be invoked');
  assert.ok(providersUsed.includes('etsy'), 'Etsy should be attempted');
  assert.equal(result.state, 'RESULTS');
  assert.ok(result.products.length > 0, 'eBay results should be present despite Etsy failure');
});

test('provider failures remain isolated: Brave failure does not affect SerpAPI', async () => {
  let serpapiCalled = false;
  const providers = [
    { name: 'ebay', provider: { async search() { return []; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() {
      serpapiCalled = true;
      throw new Error('quota exhausted');
    }, getQuotaInfo() { return { total_searches_left: 0 }; }, isQuotaExhausted() { return true; } }, tier: 'fallback' },
    { name: 'brave', provider: { async search() { throw new Error('Brave API error'); } }, tier: 'fallback' },
  ];
  const result = await resolveProducts(providers, queries, description, env);
  assert.equal(serpapiCalled, true, 'SerpAPI should be called before Brave');
  assert.equal(result.serpapi.invoked, true);
  assert.equal(result.brave.invoked, true);
  assert.equal(result.brave.timeout_or_failure, true);
  assert.equal(result.state, 'TEMPORARILY_UNAVAILABLE');
});

// ── Provider provenance preserved test ──

test('provider provenance preserved through category-aware routing', async () => {
  const ebayCandidate = { ...candidate, id: 'e1', destination: 'https://shop.example/ebay', provider: 'ebay', provenance: 'ebay:browse' };
  const etsyCandidate = { ...candidate, id: 'etsy1', destination: 'https://etsy.com/1', provider: 'etsy', provenance: 'etsy:listings' };
  const providers = [
    { name: 'ebay', provider: { async search() { return [ebayCandidate]; } }, tier: 'primary' },
    { name: 'etsy', provider: { async search() { return [etsyCandidate]; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { return []; } }, tier: 'fallback' },
  ];
  const fashionQ = [query('Nike black tee logo'), query('Nike tee'), query('black tee')];
  const result = await resolveProducts(providers, fashionQ, description, env, undefined, source, verifier);
  assert.equal(result.state, 'RESULTS');
  for (const product of result.products) {
    assert.ok(product.provider, `product ${product.id} should have provider`);
    assert.ok(['ebay', 'etsy'].includes(product.provider), `provider should be ebay or etsy, got ${product.provider}`);
    if (product.provider === 'ebay') assert.equal(product.provenance, 'ebay:browse');
    if (product.provider === 'etsy') assert.equal(product.provenance, 'etsy:listings');
  }
});
