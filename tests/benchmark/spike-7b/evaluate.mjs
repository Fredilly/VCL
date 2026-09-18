import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
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
  fs.readFileSync(resolve(__dirname, 'historical-evidence.json'), 'utf8')
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

let correct = 0;

for (const row of data.cases) {
  const result = evaluateCommerceGate(rowToDescription(row));
  const actual = result.decision;
  const pass = actual === row.expected_gate;
  if (pass) correct++;

  console.log(
    `${pass ? '✓' : '✗'} ${row.id.padEnd(17)} expected=${row.expected_gate.padEnd(8)} actual=${actual}`
  );
}

console.log(`\nMatched ${correct}/${data.cases.length}`);
