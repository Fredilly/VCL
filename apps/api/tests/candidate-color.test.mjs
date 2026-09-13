import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = await readFile(new URL('../src/candidate-color.ts', import.meta.url), 'utf8');
const stripped = source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '');
const compiled = ts.transpileModule(stripped, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const context = vm.createContext({ exports: {}, fetch, Response, URL, Uint8Array, btoa: (value) => Buffer.from(value, 'binary').toString('base64') });
vm.runInContext(compiled, context);
const { normalizeColorFamily, candidateImageColorCompatible } = context.exports;

test('normalizes common color families', () => {
  assert.equal(normalizeColorFamily('navy blue'), 'blue');
  assert.equal(normalizeColorFamily('grey'), 'gray');
  assert.equal(normalizeColorFamily('ivory'), 'cream');
});

test('rejects explicit thumbnail color mismatch when confidence is high', () => {
  assert.equal(candidateImageColorCompatible('black', { index: 0, color: 'cream', confidence: 0.96 }), false);
  assert.equal(candidateImageColorCompatible('black', { index: 0, color: 'white', confidence: 0.91 }), false);
});

test('keeps matching thumbnail colors and uncertain classifications', () => {
  assert.equal(candidateImageColorCompatible('navy', { index: 0, color: 'blue', confidence: 0.9 }), true);
  assert.equal(candidateImageColorCompatible('black', { index: 0, color: 'cream', confidence: 0.5 }), true);
  assert.equal(candidateImageColorCompatible('black', undefined), true);
});
