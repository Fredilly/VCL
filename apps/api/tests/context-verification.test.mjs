import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const stripImports = (source) => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '');
const source = await readFile(new URL('../src/commerce.ts', import.meta.url), 'utf8');
const context = vm.createContext({ exports: {} });
vm.runInContext(compile(stripImports(source)), context);
const { verifyProductCandidate, buildProductQueryVariants } = context.exports;

const description = {
  category: 'Apparel', subcategory: 't-shirts', brand_candidate: 'Hugo Boss', model_candidate: null,
  color: 'black', material: 'cotton', style_attributes: ['casual', 'long sleeve', 'crew neck'],
  visible_text: ['BOSS'], logos_markings: ['BOSS logo'], distinctive_features: [], hardware_details: [],
  shape_silhouette: ['long sleeve crew neck'], search_terms: ['Hugo Boss black long sleeve t-shirt'],
  confidence: 0.95, identity_confidence: 0.95,
};
const surface = { platform: 'youtube', title: 'Top 10 Boss Jumpers Men [2018]: Hugo Boss Black Mens Padro Half Zip Jumper, Navy Blue Zip Sweater' };
const candidate = (title) => ({ id: title, title, brand: null, model: null, category: null, image_reference: null, provenance: 'test', destination: null, price: null, currency: null, result_class: 'SIMILAR' });

test('trusted matching video title overrides conflicting generic apparel subtype for verification', () => {
  assert.equal(verifyProductCandidate(description, candidate("HUGO BOSS Men's Boss Polo Shirt"), surface), null);
  assert.equal(verifyProductCandidate(description, candidate('Hugo Boss black crewneck sweater'), surface)?.result_class, 'LIKELY');
});

test('trusted matching video title creates a context-led commerce query', () => {
  const variants = buildProductQueryVariants(description, surface);
  assert.match(variants[0].query, /Hugo Boss/i);
  assert.match(variants[0].query, /sweater|jumper/i);
});

test('untrusted unrelated video title cannot override visual type', () => {
  const unrelated = { platform: 'youtube', title: 'Nike running shoes review' };
  assert.equal(verifyProductCandidate(description, candidate("HUGO BOSS Men's Boss Polo Shirt"), unrelated)?.result_class, 'SIMILAR');
});
