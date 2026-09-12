import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const stripImports = (source) => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '');
const source = await readFile(new URL('../src/attribute-gate.ts', import.meta.url), 'utf8');
const context = vm.createContext({ exports: {} });
vm.runInContext(compile(stripImports(source)), context);
const { applyAttributeInvariantGate } = context.exports;

const description = {
  category: 'Apparel',
  subcategory: 'T-shirt',
  brand_candidate: 'BOSS',
  model_candidate: null,
  color: 'grey',
  material: 'cotton',
  style_attributes: ['casual', 'long sleeve', 'crew neck'],
  visible_text: ['BOSS'],
  logos_markings: ['BOSS logo'],
  distinctive_features: [],
  hardware_details: [],
  shape_silhouette: ['long sleeves'],
  search_terms: ['mens grey long sleeve BOSS t-shirt'],
  confidence: 0.95,
  identity_confidence: 0.95,
};

const candidate = (title) => ({ id: title, title, brand: null, model: null, category: null, image_reference: null, provenance: 'test', destination: null, price: null, currency: null, result_class: 'SIMILAR' });

test('rejects explicit womens candidates for a mens source', () => {
  const products = [candidate("BOSS Men's Grey Long Sleeve Shirt"), candidate("BOSS Women's Grey Long Sleeve Shirt")];
  assert.deepEqual(applyAttributeInvariantGate(description, products).map((p) => p.title), ["BOSS Men's Grey Long Sleeve Shirt"]);
});

test('rejects explicit short sleeve and sleeveless candidates for long sleeve source', () => {
  const products = [
    candidate("BOSS Men's Grey Long Sleeve Shirt"),
    candidate("BOSS Men's Grey Short Sleeve Shirt"),
    candidate("BOSS Men's Grey Sleeveless Top"),
  ];
  assert.deepEqual(applyAttributeInvariantGate(description, products).map((p) => p.title), ["BOSS Men's Grey Long Sleeve Shirt"]);
});

test('keeps candidates when gender or sleeve is not stated instead of guessing', () => {
  const products = [candidate('BOSS Grey Cotton Crewneck')];
  assert.equal(applyAttributeInvariantGate(description, products).length, 1);
});
