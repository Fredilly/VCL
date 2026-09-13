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

const base = {
  category: 'Apparel', subcategory: 'Sweater', brand_candidate: 'BOSS', model_candidate: null,
  color: 'black', material: 'cotton', style_attributes: ['long sleeve', 'crew neck'],
  visible_text: ['BOSS'], logos_markings: ['BOSS logo'], distinctive_features: [], hardware_details: [],
  shape_silhouette: ['long sleeve crew neck'], search_terms: ['BOSS black sweater'], confidence: 0.95, identity_confidence: 0.95,
};
const candidate = (title) => ({ id: title, title, brand: null, model: null, category: null, image_reference: null, provenance: 'test', destination: null, price: null, currency: null, result_class: 'SIMILAR' });

test('explicit conflicting color is rejected', () => {
  assert.equal(verifyProductCandidate(base, candidate('BOSS white crewneck sweater')), null);
  assert.equal(verifyProductCandidate(base, candidate('BOSS red crewneck sweater')), null);
});

test('matching color and product type can remain likely', () => {
  assert.equal(verifyProductCandidate(base, candidate('BOSS black cotton crewneck sweater'))?.result_class, 'LIKELY');
});

test('product type mismatch remains a hard rejection', () => {
  assert.equal(verifyProductCandidate(base, candidate('BOSS black cotton polo shirt')), null);
});

test('query keeps product type and color ahead of weaker evidence', () => {
  const [query] = buildProductQueryVariants(base);
  assert.match(query.query, /BOSS/i);
  assert.match(query.query, /sweater/i);
  assert.match(query.query, /black/i);
});

test('single clear video type can guide generic visual output without brand', () => {
  const generic = { ...base, brand_candidate: null, subcategory: 'Tops', search_terms: [] };
  const surface = { platform: 'youtube', title: 'Best black sweaters for men' };
  const [query] = buildProductQueryVariants(generic, surface);
  assert.match(query.query, /sweater/i);
  assert.match(query.query, /black/i);
});
