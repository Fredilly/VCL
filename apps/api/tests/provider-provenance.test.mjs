import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';
import { apparelCases, example } from './fixtures/apparel-benchmark.mjs';

const file = (name) => fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url));
const { resolveProducts } = loadModule(file('server'), { console: { error() {} } });
const { candidateKey } = loadModule(file('candidate-images'));
const { description, candidate, comparison } = example(apparelCases[0]);

const query = (q) => ({ query: q, category: 'Apparel', subcategory: 'T-shirt', brand: 'Nike', model: null, attributes: [] });
const queries = [query('Nike black tee logo'), query('Nike tee'), query('black tee')];
const source = { mimeType: 'image/png', data: 'AAAA' };
const env = { GEMINI_API_KEY: 'test-key' };
const verifier = async (_key, _model, _source, _desc, products) => ({
  comparisons: new Map(products.map((p) => [candidateKey(p), comparison])),
  compared: products.length,
  failures: 0,
});

test('provider field is preserved through metadata-only verification path', async () => {
  const serpapiCandidate = { ...candidate, provenance: 'serpapi:google-shopping', provider: 'serpapi', id: 's1' };
  const ebayCandidate = { ...candidate, provenance: 'ebay:browse', provider: 'ebay', id: 'e1', destination: 'https://shop.example/ebay' };

  const providers = [
    { name: 'serpapi', provider: { async search() { return [serpapiCandidate]; } }, tier: 'primary' },
    { name: 'ebay', provider: { async search() { return [ebayCandidate]; } }, tier: 'primary' },
  ];

  const result = await resolveProducts(providers, queries, description, env);
  assert.equal(result.state, 'RESULTS');
  for (const product of result.products) {
    assert.ok(product.provider, `product ${product.id} should have provider`);
    assert.ok(['serpapi', 'ebay'].includes(product.provider), `provider should be serpapi or ebay, got ${product.provider}`);
  }
});

test('provider field survives multimodal verification path', async () => {
  const serpapiCandidate = { ...candidate, provenance: 'serpapi:google-shopping', provider: 'serpapi', id: 's1' };
  const ebayCandidate = { ...candidate, provenance: 'ebay:browse', provider: 'ebay', id: 'e1', destination: 'https://shop.example/ebay' };

  const providers = [
    { name: 'serpapi', provider: { async search() { return [serpapiCandidate]; } }, tier: 'primary' },
    { name: 'ebay', provider: { async search() { return [ebayCandidate]; } }, tier: 'primary' },
  ];

  const result = await resolveProducts(providers, queries, description, env, undefined, source, verifier);
  assert.equal(result.state, 'RESULTS');
  for (const product of result.products) {
    assert.ok(product.provider, `product ${product.id} should have provider after multimodal verification`);
    assert.ok(['serpapi', 'ebay'].includes(product.provider));
  }
});

test('provider survives deduplication', async () => {
  const unique = { ...candidate, provenance: 'serpapi:google-shopping', provider: 'serpapi', id: 's1' };
  const duplicate = { ...unique, id: 's2' };

  const providers = [
    { name: 'serpapi', provider: { async search() { return [unique, duplicate]; } }, tier: 'primary' },
  ];

  const result = await resolveProducts(providers, queries, description, env);
  assert.ok(result.products.length >= 1);
  assert.equal(result.products[0].provider, 'serpapi');
});

test('provider survives ranking by verification_score', async () => {
  const weak = { ...candidate, provenance: 'ebay:browse', provider: 'ebay', id: 'e1', destination: 'https://shop.example/weak' };
  const strong = { ...candidate, provenance: 'serpapi:google-shopping', provider: 'serpapi', id: 's1' };

  const providers = [
    { name: 'ebay', provider: { async search() { return [weak]; } }, tier: 'primary' },
    { name: 'serpapi', provider: { async search() { return [strong]; } }, tier: 'primary' },
  ];

  const result = await resolveProducts(providers, queries, description, env);
  assert.ok(result.products.length >= 1);
  for (const product of result.products) {
    assert.ok(product.provider, 'each ranked product should retain provider');
  }
});

test('providers_used tracks which providers contributed candidates', async () => {
  const providers = [
    { name: 'serpapi', provider: { async search() { return [{ ...candidate, provider: 'serpapi', id: 's1' }]; } }, tier: 'primary' },
    { name: 'ebay', provider: { async search() { return [{ ...candidate, provider: 'ebay', id: 'e1', destination: 'https://shop.example/ebay' }]; } }, tier: 'primary' },
  ];

  const result = await resolveProducts(providers, queries, description, env);
  assert.ok(result.providers_used.includes('serpapi'));
  assert.ok(result.providers_used.includes('ebay'));
});

test('provider field defaults to undefined when not set by provider', async () => {
  const providers = [
    { name: 'unknown', provider: { async search() { return [{ ...candidate, id: 'u1' }]; } }, tier: 'primary' },
  ];

  const result = await resolveProducts(providers, queries, description, env);
  assert.ok(result.products.length >= 1);
  assert.equal(result.products[0].provider, undefined);
});

test('eBay adapter sets provider to ebay', async () => {
  const ebayCtx = loadModule(file('ebay-commerce'), {
    EbayAuth: { getAccessToken: async () => 'token', getBrowseBaseUrl: () => 'https://api.sandbox.ebay.com' },
    fetch: async () => Response.json({
      itemSummaries: [{ itemId: '1', title: 'Nike Air Max 90 White', price: { value: '99.00', currency: 'USD' } }],
    }),
  });
  const provider = new ebayCtx.EbayCommerceProvider({ getAccessToken: async () => 'token', getBrowseBaseUrl: () => 'https://api.sandbox.ebay.com' });
  const results = await provider.search({ query: 'Nike Air Max 90', category: 'Apparel', subcategory: 'Sneakers', brand: 'Nike', model: 'Air Max 90', attributes: [] });
  for (const r of results) {
    assert.equal(r.provider, 'ebay');
  }
});
