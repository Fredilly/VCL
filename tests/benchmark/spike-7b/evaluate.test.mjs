import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ts = createRequire(resolve(__dirname, '../../../apps/api/src/commerce-gate.ts'))('typescript');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const stripImports = (source) => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '');

const gateSource = fs.readFileSync(resolve(__dirname, '../../../apps/api/src/commerce-gate.ts'), 'utf8');
const gateContext = vm.createContext({ exports: {} });
vm.runInContext(compile(stripImports(gateSource)), gateContext);
const { evaluateCommerceGate } = gateContext.exports;

const data = JSON.parse(
  fs.readFileSync(new URL('./historical-evidence.json', import.meta.url), 'utf8')
);

function rowToDescription(row) {
  const attrs = row.attributes ?? [];
  return {
    category: row.category ?? '',
    subcategory: row.subcategory ?? '',
    brand_candidate: row.brand ?? null,
    model_candidate: row.model ?? null,
    color: '',
    material: '',
    style_attributes: attrs,
    visible_text: [],
    logos_markings: [],
    distinctive_features: [],
    hardware_details: [],
    shape_silhouette: [],
    search_terms: [],
    confidence: 0.9,
    identity_confidence: 0.9,
  };
}

test('Spike 7B historical evidence gate matches expected outcomes', () => {
  const results = data.cases.map((row) => ({
    id: row.id,
    expected: row.expected_gate,
    actual: evaluateCommerceGate(rowToDescription(row)).decision,
  }));

  const failures = results.filter((r) => r.expected !== r.actual);
  assert.deepEqual(failures, []);
});

test('Spike 7B historical evidence gate summary is 9/9', () => {
  const matched = data.cases.filter((row) => evaluateCommerceGate(rowToDescription(row)).decision === row.expected_gate).length;
  assert.equal(matched, 9);
  assert.equal(data.cases.length, 9);
});
