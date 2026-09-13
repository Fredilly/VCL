import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const stripImports = (source) => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '');

const commerceSource = await readFile(new URL('../src/commerce.ts', import.meta.url), 'utf8');
const commerceContext = vm.createContext({ exports: {} });
vm.runInContext(compile(stripImports(commerceSource)), commerceContext);
const { buildProductQuery, buildProductQueryVariants, verifyProductCandidate, CommerceNoResultsError, CommerceProviderError } = commerceContext.exports;

const description = (overrides = {}) => ({ category: 'Apparel', subcategory: 'Sweater', brand_candidate: 'BOSS', model_candidate: null,
  color: 'black', material: 'wool', style_attributes: [], visible_text: [], logos_markings: [], distinctive_features: [], hardware_details: [], shape_silhouette: [], search_terms: [], confidence: 0.9, identity_confidence: 0.9, ...overrides });
const candidate = (title, overrides = {}) => ({ id: title, title, brand: null, model: null, category: null, image_reference: null, provenance: 'test', destination: title, price: null, currency: null, result_class: 'SIMILAR', ...overrides });

test('verification rejects BOSS sweater versus BOSS polo', () => {
  assert.equal(verifyProductCandidate(description(), candidate('BOSS logo polo shirt')), null);
});

test('verification accepts matching type and brand as LIKELY', () => {
  assert.equal(verifyProductCandidate(description(), candidate('BOSS black wool sweater'))?.result_class, 'LIKELY');
});

test('verification limits correct type without brand to SIMILAR', () => {
  assert.equal(verifyProductCandidate(description(), candidate('Black wool sweater'))?.result_class, 'SIMILAR');
});

test('verification accepts strong brand and model agreement as LIKELY', () => {
  assert.equal(verifyProductCandidate(description({ model_candidate: 'Half-Zip 101' }), candidate('BOSS Half-Zip 101'))?.result_class, 'LIKELY');
});

test('verification rejects weak unrelated candidates and never emits EXACT', () => {
  const result = verifyProductCandidate(description(), candidate('Kitchen table lamp'));
  assert.equal(result, null);
  assert.notEqual(result?.result_class, 'EXACT');
});

test('buildProductQuery prioritizes brand/model/search evidence', () => {
  const query = buildProductQuery({
    category: 'Apparel', subcategory: 'Sneakers', brand_candidate: 'Nike', model_candidate: 'Air Max 90',
    color: 'white', material: 'leather', style_attributes: ['low top'], visible_text: [], logos_markings: [], distinctive_features: [], hardware_details: [], shape_silhouette: [], search_terms: ['Nike Air Max 90 white'], confidence: 0.9, identity_confidence: 0.95,
  });
  assert.match(query.query, /Nike/);
  assert.match(query.query, /Air Max 90/);
  assert.equal(query.brand, 'Nike');
  assert.equal(query.model, 'Air Max 90');
});

test('buildProductQuery falls back to visual attributes when search terms are absent', () => {
  const query = buildProductQuery({
    category: 'Home', subcategory: 'Lamp', brand_candidate: null, model_candidate: null,
    color: 'brass', material: 'metal', style_attributes: ['art deco'], visible_text: [], logos_markings: [], distinctive_features: [], hardware_details: [], shape_silhouette: [], search_terms: [], confidence: 0.7, identity_confidence: 0,
  });
  assert.equal(query.query, 'brass metal art deco Lamp');
});

test('buildProductQueryVariants broadens from precise identity to visual evidence', () => {
  const variants = buildProductQueryVariants({
    category: 'Apparel', subcategory: 'Sunglasses', brand_candidate: 'Persol', model_candidate: 'PO0649',
    color: 'tortoiseshell', material: 'acetate', style_attributes: ['oversized', 'square'],
    visible_text: [], logos_markings: ['arrow emblem on temple'], distinctive_features: [], hardware_details: [], shape_silhouette: ['keyhole bridge'], search_terms: ['Persol PO0649 tortoiseshell'], confidence: 0.92, identity_confidence: 0.9,
  });
  assert.equal(variants.length, 3);
  assert.match(variants[0].query, /Persol/);
  assert.match(variants[1].query, /Sunglasses/);
  assert.match(variants[2].query, /tortoiseshell/);
});

test('visible markings and text strengthen commerce queries', () => {
  const query = buildProductQuery({ category: 'Apparel', subcategory: 'Cap', brand_candidate: null, model_candidate: null,
    color: 'black', material: 'cotton', style_attributes: [], visible_text: ['NYC'], logos_markings: ['embroidered Yankees logo'], distinctive_features: [], hardware_details: [], shape_silhouette: ['six-panel'], search_terms: [], confidence: 0.8, identity_confidence: 0.35 });
  assert.match(query.query, /NYC/);
  assert.match(query.query, /Yankees/);
});

test('missing identity evidence does not invent a brand or model', () => {
  const query = buildProductQuery({ category: 'Home', subcategory: 'Mug', brand_candidate: null, model_candidate: null,
    color: 'red', material: 'ceramic', style_attributes: [], visible_text: [], logos_markings: [], distinctive_features: [], hardware_details: [], shape_silhouette: [], search_terms: [], confidence: 0.7, identity_confidence: 0 });
  assert.equal(query.brand, null);
  assert.equal(query.model, null);
  assert.doesNotMatch(query.query, /Nike|Apple|Yankees/);
});

test('commerce errors expose stable resolver codes', () => {
  assert.equal(new CommerceNoResultsError().code, 'NO_RESULTS');
  assert.equal(new CommerceProviderError('failed').code, 'COMMERCE_PROVIDER_ERROR');
});

const ebaySource = await readFile(new URL('../src/ebay-commerce.ts', import.meta.url), 'utf8');

function makeMockAuth() {
  return { getAccessToken: async () => 'mock-token', getBrowseBaseUrl: () => 'https://api.sandbox.ebay.com' };
}

const ebayContext = vm.createContext({
  exports: {},
  CommerceNoResultsError,
  CommerceProviderError,
  EbayAuth: makeMockAuth(),
  crypto: { randomUUID: () => 'generated' },
  URL,
  AbortSignal,
  fetch: async () => Response.json({
    itemSummaries: [{ itemId: '123', title: 'Nike Air Max 90 White', image: { imageUrl: 'https://example.test/image.jpg' },
      itemWebUrl: 'https://example.test/item', price: { value: '99.00', currency: 'USD' }, categories: [{ categoryName: 'Sneakers' }] }],
  }),
});
vm.runInContext(compile(stripImports(ebaySource)), ebayContext);
const { EbayCommerceProvider } = ebayContext.exports;

test('eBay adapter normalizes candidates and never emits EXACT', async () => {
  const provider = new EbayCommerceProvider(makeMockAuth());
  const [candidate] = await provider.search({ query: 'Nike Air Max 90', category: 'Apparel', subcategory: 'Sneakers', brand: 'Nike', model: 'Air Max 90', attributes: [] });
  assert.equal(candidate.title, 'Nike Air Max 90 White');
  assert.equal(candidate.result_class, 'LIKELY');
  assert.notEqual(candidate.result_class, 'EXACT');
  assert.equal(candidate.price, '99.00');
});
