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

const credentialsSource = await readFile(new URL('../src/ebay-credentials.ts', import.meta.url), 'utf8');

function loadCredentialsModule() {
  const ctx = vm.createContext({ exports: {} });
  vm.runInContext(compile(stripImports(credentialsSource)), ctx);
  return ctx.exports;
}

const { resolveEbayCredentials } = loadCredentialsModule();

test('sandbox credential selection with explicit EBAY_ENVIRONMENT=sandbox', () => {
  const result = resolveEbayCredentials({
    EBAY_ENVIRONMENT: 'sandbox',
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-secret',
    EBAY_PRODUCTION_CLIENT_ID: 'prod-id',
    EBAY_PRODUCTION_CLIENT_SECRET: 'prod-secret',
  });
  assert.equal(result.clientId, 'sb-id');
  assert.equal(result.clientSecret, 'sb-secret');
  assert.equal(result.sandbox, true);
});

test('production credential selection with explicit EBAY_ENVIRONMENT=production', () => {
  const result = resolveEbayCredentials({
    EBAY_ENVIRONMENT: 'production',
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-secret',
    EBAY_PRODUCTION_CLIENT_ID: 'prod-id',
    EBAY_PRODUCTION_CLIENT_SECRET: 'prod-secret',
  });
  assert.equal(result.clientId, 'prod-id');
  assert.equal(result.clientSecret, 'prod-secret');
  assert.equal(result.sandbox, false);
});

test('EBAY_ENVIRONMENT=sandbox returns null when sandbox credentials missing', () => {
  const result = resolveEbayCredentials({
    EBAY_ENVIRONMENT: 'sandbox',
    EBAY_PRODUCTION_CLIENT_ID: 'prod-id',
    EBAY_PRODUCTION_CLIENT_SECRET: 'prod-secret',
  });
  assert.equal(result, null);
});

test('EBAY_ENVIRONMENT=production returns null when production credentials missing', () => {
  const result = resolveEbayCredentials({
    EBAY_ENVIRONMENT: 'production',
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-secret',
  });
  assert.equal(result, null);
});

test('legacy fallback with EBAY_CLIENT_ID and EBAY_CLIENT_SECRET', () => {
  const result = resolveEbayCredentials({
    EBAY_CLIENT_ID: 'legacy-id',
    EBAY_CLIENT_SECRET: 'legacy-secret',
  });
  assert.equal(result.clientId, 'legacy-id');
  assert.equal(result.clientSecret, 'legacy-secret');
  assert.equal(result.sandbox, true);
});

test('legacy fallback with EBAY_SANDBOX=false sets sandbox to false', () => {
  const result = resolveEbayCredentials({
    EBAY_CLIENT_ID: 'legacy-id',
    EBAY_CLIENT_SECRET: 'legacy-secret',
    EBAY_SANDBOX: 'false',
  });
  assert.equal(result.sandbox, false);
});

test('missing credentials returns null', () => {
  assert.equal(resolveEbayCredentials({}), null);
});

test('partial legacy credentials (only CLIENT_ID) returns null', () => {
  assert.equal(resolveEbayCredentials({ EBAY_CLIENT_ID: 'id' }), null);
});

test('partial legacy credentials (only CLIENT_SECRET) returns null', () => {
  assert.equal(resolveEbayCredentials({ EBAY_CLIENT_SECRET: 'secret' }), null);
});

test('invalid EBAY_ENVIRONMENT returns null', () => {
  const result = resolveEbayCredentials({
    EBAY_ENVIRONMENT: 'staging',
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-secret',
  });
  assert.equal(result, null);
});

test('empty string EBAY_ENVIRONMENT falls through to new/legacy resolution', () => {
  const result = resolveEbayCredentials({
    EBAY_ENVIRONMENT: '',
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-secret',
  });
  assert.equal(result.clientId, 'sb-id');
  assert.equal(result.clientSecret, 'sb-secret');
  assert.equal(result.sandbox, true);
});

test('new vars without explicit EBAY_ENVIRONMENT: both pairs present returns null (ambiguous)', () => {
  const result = resolveEbayCredentials({
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-secret',
    EBAY_PRODUCTION_CLIENT_ID: 'prod-id',
    EBAY_PRODUCTION_CLIENT_SECRET: 'prod-secret',
  });
  assert.equal(result, null, 'ambiguous when both pairs present without explicit EBAY_ENVIRONMENT');
});

test('new vars without explicit EBAY_ENVIRONMENT: sandbox pair only', () => {
  const result = resolveEbayCredentials({
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-secret',
  });
  assert.equal(result.clientId, 'sb-id');
  assert.equal(result.clientSecret, 'sb-secret');
  assert.equal(result.sandbox, true);
});

test('new vars without explicit EBAY_ENVIRONMENT: production pair only', () => {
  const result = resolveEbayCredentials({
    EBAY_PRODUCTION_CLIENT_ID: 'prod-id',
    EBAY_PRODUCTION_CLIENT_SECRET: 'prod-secret',
  });
  assert.equal(result.clientId, 'prod-id');
  assert.equal(result.clientSecret, 'prod-secret');
  assert.equal(result.sandbox, false);
});

test('EBAY_DEV_ID is passed through when set', () => {
  const result = resolveEbayCredentials({
    EBAY_ENVIRONMENT: 'sandbox',
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-secret',
    EBAY_DEV_ID: 'dev-123',
  });
  assert.equal(result.devId, 'dev-123');
});

test('EBAY_DEV_ID is absent from result when not set', () => {
  const result = resolveEbayCredentials({
    EBAY_ENVIRONMENT: 'sandbox',
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-secret',
  });
  assert.equal('devId' in result, false);
});

test('new vars take precedence over legacy when both present (sandbox pair)', () => {
  const result = resolveEbayCredentials({
    EBAY_SANDBOX_CLIENT_ID: 'sb-new',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-new-secret',
    EBAY_CLIENT_ID: 'legacy-id',
    EBAY_CLIENT_SECRET: 'legacy-secret',
  });
  assert.equal(result.clientId, 'sb-new');
  assert.equal(result.clientSecret, 'sb-new-secret');
  assert.equal(result.sandbox, true);
});

test('new vars take precedence over legacy when both present (production pair)', () => {
  const result = resolveEbayCredentials({
    EBAY_PRODUCTION_CLIENT_ID: 'prod-new',
    EBAY_PRODUCTION_CLIENT_SECRET: 'prod-new-secret',
    EBAY_CLIENT_ID: 'legacy-id',
    EBAY_CLIENT_SECRET: 'legacy-secret',
  });
  assert.equal(result.clientId, 'prod-new');
  assert.equal(result.clientSecret, 'prod-new-secret');
  assert.equal(result.sandbox, false);
});

test('no secret leakage: returned object has exactly the expected keys', () => {
  const result = resolveEbayCredentials({
    EBAY_ENVIRONMENT: 'sandbox',
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-secret',
  });
  const keys = Object.keys(result);
  assert.deepEqual(keys.sort(), ['clientId', 'clientSecret', 'sandbox']);
});

test('no secret leakage: returned object has exactly the expected keys with devId', () => {
  const result = resolveEbayCredentials({
    EBAY_ENVIRONMENT: 'sandbox',
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-secret',
    EBAY_DEV_ID: 'dev-123',
  });
  const keys = Object.keys(result);
  assert.deepEqual(keys.sort(), ['clientId', 'clientSecret', 'devId', 'sandbox']);
});

test('EBAY_ENVIRONMENT is case-insensitive', () => {
  const result = resolveEbayCredentials({
    EBAY_ENVIRONMENT: 'SANDBOX',
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-secret',
  });
  assert.equal(result.sandbox, true);
});

test('partial sandbox pair (only ID) returns null', () => {
  const result = resolveEbayCredentials({
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
  });
  assert.equal(result, null);
});

test('partial production pair (only secret) returns null', () => {
  const result = resolveEbayCredentials({
    EBAY_PRODUCTION_CLIENT_SECRET: 'prod-secret',
  });
  assert.equal(result, null);
});

test('legacy credentials never returned when new sandbox pair available', () => {
  const result = resolveEbayCredentials({
    EBAY_SANDBOX_CLIENT_ID: 'sb-id',
    EBAY_SANDBOX_CLIENT_SECRET: 'sb-secret',
    EBAY_CLIENT_ID: 'legacy-id',
    EBAY_CLIENT_SECRET: 'legacy-secret',
  });
  assert.equal(result.clientId, 'sb-id');
  assert.equal(result.clientSecret, 'sb-secret');
});

test('legacy credentials never returned when new production pair available', () => {
  const result = resolveEbayCredentials({
    EBAY_PRODUCTION_CLIENT_ID: 'prod-id',
    EBAY_PRODUCTION_CLIENT_SECRET: 'prod-secret',
    EBAY_CLIENT_ID: 'legacy-id',
    EBAY_CLIENT_SECRET: 'legacy-secret',
  });
  assert.equal(result.clientId, 'prod-id');
  assert.equal(result.clientSecret, 'prod-secret');
});
