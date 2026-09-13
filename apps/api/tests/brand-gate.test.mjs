import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const stripImports = (source) => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '');
const source = await readFile(new URL('../src/brand-gate.ts', import.meta.url), 'utf8');
const context = vm.createContext({ exports: {} });
vm.runInContext(compile(stripImports(source)), context);
const { applyBrandGate, candidateMatchesBrand } = context.exports;

const candidate = (title) => ({ id: title, title, brand: null, model: null, category: null, image_reference: null, provenance: 'test', destination: null, price: null, currency: null, result_class: 'SIMILAR' });
const description = { brand_candidate: 'BOSS', identity_confidence: 0.95 };

test('high-confidence brand rejects other brands', () => {
  const products = [candidate('BOSS black sweater'), candidate('UNIQLO black sweater'), candidate('Gap black sweater')];
  assert.deepEqual(applyBrandGate(description, products).map((product) => product.title), ['BOSS black sweater']);
});

test('low-confidence brand does not hard-filter alternatives', () => {
  const products = [candidate('BOSS black sweater'), candidate('UNIQLO black sweater')];
  assert.equal(applyBrandGate({ ...description, identity_confidence: 0.6 }, products).length, 2);
});

test('Hugo Boss wording matches BOSS Hugo Boss recognition', () => {
  assert.equal(candidateMatchesBrand("HUGO BOSS Men's crewneck sweater", 'BOSS Hugo Boss'), true);
});
