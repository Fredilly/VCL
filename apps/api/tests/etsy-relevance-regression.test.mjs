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

const commerceSource = await readFile(new URL('../src/commerce.ts', import.meta.url), 'utf8');
const etsySource = await readFile(new URL('../src/etsy-commerce.ts', import.meta.url), 'utf8');
const commerceContext = vm.createContext({ exports: {} });
vm.runInContext(compile(stripImports(commerceSource)), commerceContext);
const { CommerceNoResultsError, CommerceProviderError } = commerceContext.exports;

function makeContext(results) {
  return vm.createContext({
    exports: {},
    CommerceNoResultsError,
    CommerceProviderError,
    crypto: { randomUUID: () => 'generated-id' },
    URL,
    AbortSignal,
    fetch: async () => Response.json({ count: results.length, results }),
    Date,
    console,
  });
}

function providerFor(results) {
  const ctx = makeContext(results);
  vm.runInContext(compile(stripImports(etsySource)), ctx);
  return new ctx.exports.EtsyCommerceProvider({ apiKey: 'test-key', sharedSecret: 'test-secret' });
}

const adultSweaterQuery = {
  query: 'cream wool sweater men',
  category: 'apparel',
  subcategory: 'sweater',
  brand: null,
  model: null,
  attributes: ['sweater', 'cream', 'wool', 'men'],
};

test('Etsy rejects pet and doll clothing for an adult sweater query', async () => {
  const provider = providerFor([
    { listing_id: 1, title: 'Knitted Dog Sweater', tags: ['pet clothing', 'dog sweater'] },
    { listing_id: 2, title: 'Mini Doll Sweater for Blythe', tags: ['doll clothes'] },
    { listing_id: 3, title: 'Mens Cream Wool Knit Sweater', tags: ['mens sweater', 'wool'] },
  ]);

  const results = await provider.search(adultSweaterQuery);
  assert.deepEqual(results.map((result) => result.title), ['Mens Cream Wool Knit Sweater']);
});

test('Etsy rejects child apparel when source query explicitly says adult', async () => {
  const provider = providerFor([
    { listing_id: 1, title: 'Kids Cream Wool Sweater', tags: ['children', 'sweater'] },
    { listing_id: 2, title: 'Adult Cream Wool Pullover', tags: ['adult sweater'] },
  ]);

  const results = await provider.search(adultSweaterQuery);
  assert.deepEqual(results.map((result) => result.title), ['Adult Cream Wool Pullover']);
});

test('Etsy prefers no result when every candidate changes the audience', async () => {
  const provider = providerFor([
    { listing_id: 1, title: 'Dog Cable Knit Sweater', tags: ['pet'] },
    { listing_id: 2, title: 'Barbie Doll Knit Sweater', tags: ['doll clothes'] },
  ]);

  await assert.rejects(
    () => provider.search(adultSweaterQuery),
    (error) => error?.code === 'NO_RESULTS',
  );
});

test('Etsy keeps pet apparel when the source query is explicitly for a pet', async () => {
  const provider = providerFor([
    { listing_id: 1, title: 'Dog Cable Knit Sweater', tags: ['pet clothing'] },
  ]);
  const petQuery = {
    query: 'dog sweater',
    category: 'apparel',
    subcategory: 'sweater',
    brand: null,
    model: null,
    attributes: ['dog', 'sweater'],
  };

  const results = await provider.search(petQuery);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Dog Cable Knit Sweater');
});
