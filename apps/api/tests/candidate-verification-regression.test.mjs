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

const source = await readFile(new URL('../src/commerce.ts', import.meta.url), 'utf8');
const context = vm.createContext({ exports: {} });
vm.runInContext(compile(stripImports(source)), context);
const { verifyProductCandidate } = context.exports;

test('generic Tops vision output still rejects T-shirts when stronger evidence says sweater', () => {
  const description = {
    category: 'Apparel',
    subcategory: 'Tops',
    brand_candidate: 'BOSS',
    model_candidate: null,
    color: 'black',
    material: 'cotton',
    style_attributes: ['long sleeve', 'crew neck', 'minimalist'],
    visible_text: ['BOSS'],
    logos_markings: ['BOSS chest logo'],
    distinctive_features: [],
    hardware_details: [],
    shape_silhouette: ['long sleeve crew neck'],
    search_terms: ['BOSS black crewneck sweater'],
    confidence: 0.95,
    identity_confidence: 0.95,
  };
  const candidate = {
    id: 'boss-tee',
    title: 'Hugo Boss Logo Crew-neck Men T-Shirt - Black',
    brand: 'BOSS',
    model: null,
    category: 'Tops',
    image_reference: null,
    provenance: 'test',
    destination: 'https://example.test/boss-tee',
    price: '137',
    currency: 'USD',
    result_class: 'SIMILAR',
  };

  assert.equal(verifyProductCandidate(description, candidate), null);
});
