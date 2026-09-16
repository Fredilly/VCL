import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';
import { apparelCases, example } from './fixtures/apparel-benchmark.mjs';
const filename = fileURLToPath(new URL('../src/candidate-images.ts', import.meta.url));
const { parseComparisons, safeImageUrl, parseSourceImage } = loadModule(filename);
const image = { mimeType: 'image/png', data: 'AAAA' };

test('image parser rejects invalid confidence, absent source and duplicate/invented candidate indexes', () => {
  const { comparison } = example(apparelCases[0]);
  const row = { index: 0, attributes: comparison.candidate, ...comparison };
  assert.equal(parseComparisons({ source: comparison.source, candidates: [row] }, 1).size, 1);
  assert.equal(parseComparisons({ source: {}, candidates: [row] }, 1).size, 0);
  assert.equal(parseComparisons({ source: comparison.source, candidates: [row, row] }, 1).size, 0);
  for (const mutation of [{ index: 9 }, { index: -1 }, { confidence: '0.99' }, { confidence: 2 }, { similarity: NaN }]) {
    assert.equal(parseComparisons({ source: comparison.source, candidates: [{ ...row, ...mutation }] }, 1).size, 0);
  }
});

test('candidate image requests reject private/local URLs, unsafe protocols and oversized source input', () => {
  for (const url of ['http://cdn.shopify.com/a.png', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://host.internal/a', 'https://localhost/a', 'https://user:pass@cdn.shopify.com/a']) assert.equal(safeImageUrl(url), false, url);
  assert.equal(safeImageUrl('https://cdn.shopify.com/a.png'), true);
  assert.equal(parseSourceImage('data:image/svg+xml;base64,AAAA'), null);
  assert.equal(parseSourceImage(`data:image/png;base64,${'A'.repeat(2_800_000)}`), null);
  assert.ok(parseSourceImage('data:image/png;base64,AAAA'));
});

test('multimodal request includes source crop, candidate image, title and context but no rank/price', async () => {
  const { candidate, description, comparison } = example(apparelCases[0]);
  let request;
  const { compareCandidateImages } = loadModule(filename, { fetch: async (url, options) => {
    if (String(url).includes('generativelanguage')) {
      request = JSON.parse(options.body);
      assert.equal(options.headers['x-goog-api-key'], 'test-key');
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ source: comparison.source,
        candidates: [{ index: 0, attributes: comparison.candidate, ...comparison }] }) }] } }] });
    }
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  } });
  const result = await compareCandidateImages('test-key', 'configured-model', image, description, [candidate], { title: 'Product review' });
  assert.equal(result.compared, 1);
  assert.deepEqual(request.generationConfig.responseSchema.required, ['source', 'candidates']);
  const parts = request.contents[0].parts;
  assert.equal(parts.filter((part) => part.inlineData).length, 2);
  assert.equal(parts[1].inlineData.data, image.data);
  assert.ok(parts.some((part) => part.text?.includes(candidate.title)));
  assert.ok(parts.some((part) => part.text?.includes('Product review')));
  assert.ok(parts.every((part) => !part.text?.includes('"price"')));
});

test('failed, oversized and non-image fetches are reported as unavailable, never false comparisons', async () => {
  const { candidate, description } = example(apparelCases[0]);
  for (const response of [new Response('error', { status: 500 }), new Response('html', { headers: { 'content-type': 'text/html' } }),
    new Response('large', { headers: { 'content-type': 'image/png', 'content-length': '9999999' } })]) {
    const { compareCandidateImages } = loadModule(filename, { fetch: async () => response });
    const result = await compareCandidateImages('key', 'model', image, description, [candidate]);
    assert.equal(result.compared, 0); assert.equal(result.failures, 1);
    assert.equal(Object.values(result.failure_reasons).reduce((sum, count) => sum + count, 0), 1);
  }
});

test('thumbnail redirects are followed only to validated public hosts', async () => {
  const { candidate, description } = example(apparelCases[0]);
  let calls = 0;
  const { compareCandidateImages } = loadModule(filename, { fetch: async (_url, options) => {
    calls++; assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
  } });
  const result = await compareCandidateImages('key', 'model', image, description, [candidate]);
  assert.equal(calls, 1); assert.equal(result.failure_reasons.image_redirect, 1);
});

test('image subrequest budget is shared across broadening and leaves room for retrieval', async () => {
  const { candidate, description, comparison } = example(apparelCases[0]);
  let requests = 0, modelCalls = 0;
  const { compareCandidateImages, imageRequestBudget } = loadModule(filename, { fetch: async (url, options) => {
    requests++;
    if (String(url).includes('generativelanguage')) {
      modelCalls++;
      const count = JSON.parse(options.body).contents[0].parts.filter((p) => p.inlineData).length - 1;
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ source: comparison.source,
        candidates: Array.from({ length: count }, (_, index) => ({ index, attributes: comparison.candidate, ...comparison })) }) }] } }] });
    }
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  } });
  const budget = imageRequestBudget();
  const products = Array.from({ length: 24 }, (_, i) => ({ ...candidate, id: String(i) }));
  const first = await compareCandidateImages('key', 'model', image, description, products, undefined, budget);
  const second = await compareCandidateImages('key', 'model', image, description, products.slice(0, 12), undefined, budget);
  const third = await compareCandidateImages('key', 'model', image, description, products, undefined, budget);
  assert.equal(first.compared, 24); assert.equal(second.compared, 12);
  assert.equal(third.compared, 0); assert.equal(third.failure_reasons.image_budget, 24);
  assert.equal(requests, 42); assert.equal(modelCalls, 6); assert.equal(budget.remaining, 0);
});

test('verification batches run sequentially: second batch starts only after first completes', async () => {
  const { candidate, description, comparison } = example(apparelCases[0]);
  let concurrent = 0, maxConcurrent = 0, modelCalls = 0;
  const { compareCandidateImages } = loadModule(filename, { fetch: async (url, options) => {
    if (!String(url).includes('generativelanguage')) {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    }
    modelCalls++;
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const count = JSON.parse(options.body).contents[0].parts.filter((p) => p.inlineData).length - 1;
    concurrent--;
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ source: comparison.source,
      candidates: Array.from({ length: count }, (_, index) => ({ index, attributes: comparison.candidate, ...comparison })) }) }] } }] });
  } });
  const products = Array.from({ length: 12 }, (_, i) => ({ ...candidate, id: String(i), destination: `https://shop.example/${i}` }));
  const result = await compareCandidateImages('key', 'model', image, description, products);
  assert.equal(result.compared, 12);
  assert.equal(modelCalls, 2);
  assert.equal(maxConcurrent, 1);
});
