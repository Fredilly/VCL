import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const commerceSource = await readFile(new URL('../src/commerce.ts', import.meta.url), 'utf8');
const commerceContext = vm.createContext({ exports: {} });
vm.runInContext(compile(commerceSource.replace("import type { ObjectDescription } from './types.js';\n", '')), commerceContext);
const { buildProductQuery } = commerceContext.exports;

test('buildProductQuery prioritizes brand/model/search evidence', () => {
  const query = buildProductQuery({
    category: 'Apparel', subcategory: 'Sneakers', brand_candidate: 'Nike', model_candidate: 'Air Max 90',
    color: 'white', material: 'leather', style_attributes: ['low top'], search_terms: ['Nike Air Max 90 white'], confidence: 0.9,
  });
  assert.match(query.query, /Nike/);
  assert.match(query.query, /Air Max 90/);
  assert.equal(query.brand, 'Nike');
  assert.equal(query.model, 'Air Max 90');
});

test('buildProductQuery falls back to visual attributes when search terms are absent', () => {
  const query = buildProductQuery({
    category: 'Home', subcategory: 'Lamp', brand_candidate: null, model_candidate: null,
    color: 'brass', material: 'metal', style_attributes: ['art deco'], search_terms: [], confidence: 0.7,
  });
  assert.equal(query.query, 'brass metal art deco Lamp');
});

const ebaySource = await readFile(new URL('../src/ebay-commerce.ts', import.meta.url), 'utf8');
const ebayContext = vm.createContext({ exports: {}, crypto: { randomUUID: () => 'generated' }, URL, fetch: async () => Response.json({
  itemSummaries: [{ itemId: '123', title: 'Nike Air Max 90 White', image: { imageUrl: 'https://example.test/image.jpg' },
    itemWebUrl: 'https://example.test/item', price: { value: '99.00', currency: 'USD' }, categories: [{ categoryName: 'Sneakers' }] }],
}) });
vm.runInContext(compile(ebaySource.replace("import type { CommerceProvider, ProductCandidate, ProductQuery } from './commerce.js';\n", '')), ebayContext);
const { EbayCommerceProvider } = ebayContext.exports;

test('eBay adapter normalizes candidates and never emits EXACT', async () => {
  const provider = new EbayCommerceProvider('token');
  const [candidate] = await provider.search({ query: 'Nike Air Max 90', category: 'Apparel', subcategory: 'Sneakers', brand: 'Nike', model: 'Air Max 90', attributes: [] });
  assert.equal(candidate.title, 'Nike Air Max 90 White');
  assert.equal(candidate.result_class, 'LIKELY');
  assert.notEqual(candidate.result_class, 'EXACT');
  assert.equal(candidate.price, '99.00');
});
