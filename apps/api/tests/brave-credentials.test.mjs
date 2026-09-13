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

function loadModule(source, context) {
  const compiled = compile(stripImports(source));
  vm.runInContext(compiled, context);
  return context.exports;
}

const credentialsSource = await readFile(new URL('../src/brave-credentials.ts', import.meta.url), 'utf8');

test('credentials: resolveBraveCredentials returns credentials when env var present', () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveBraveCredentials({ BRAVE_SEARCH_API_KEY: 'brave-test-key' });
  assert.ok(creds, 'should return credentials');
  assert.equal(creds.apiKey, 'brave-test-key');
});

test('credentials: resolveBraveCredentials trims whitespace', () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveBraveCredentials({ BRAVE_SEARCH_API_KEY: '  brave-key  ' });
  assert.ok(creds, 'should return credentials');
  assert.equal(creds.apiKey, 'brave-key');
});

test('credentials: resolveBraveCredentials returns null when key missing', () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveBraveCredentials({});
  assert.equal(creds, null);
});

test('credentials: resolveBraveCredentials returns null when key is empty string', () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveBraveCredentials({ BRAVE_SEARCH_API_KEY: '' });
  assert.equal(creds, null);
});

test('credentials: resolveBraveCredentials returns null when key is whitespace only', () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveBraveCredentials({ BRAVE_SEARCH_API_KEY: '   ' });
  assert.equal(creds, null);
});

test('credentials: resolveBraveCredentials returns null when key is undefined', () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveBraveCredentials({ BRAVE_SEARCH_API_KEY: undefined });
  assert.equal(creds, null);
});
