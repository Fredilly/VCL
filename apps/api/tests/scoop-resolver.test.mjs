import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const commerceSource = await readFile(new URL('../src/commerce.ts', import.meta.url), 'utf8');
const resolverSource = await readFile(new URL('../src/scoop-resolver.ts', import.meta.url), 'utf8');

function stripImports(source) {
  return source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '');
}

const commerceContext = vm.createContext({ exports: {} });
vm.runInContext(compile(stripImports(commerceSource)), commerceContext);

const resolverCompiled = compile(stripImports(resolverSource))
  .replace('commerce_js_1.buildProductQueryVariants', 'buildProductQueryVariants');
const resolverContext = vm.createContext({
  exports: {},
  buildProductQueryVariants: commerceContext.exports.buildProductQueryVariants,
});
vm.runInContext(resolverCompiled, resolverContext);

const { buildScoopIntent, ScoopResolver } = resolverContext.exports;

function description(overrides = {}) {
  return {
    category: 'apparel',
    subcategory: 'basketball jersey',
    brand_candidate: null,
    model_candidate: null,
    color: 'red',
    material: 'polyester',
    style_attributes: [],
    visible_text: ['DURANT', '7'],
    logos_markings: ['ROCKETS'],
    distinctive_features: ['white chest lettering'],
    hardware_details: [],
    shape_silhouette: ['sleeveless jersey'],
    search_terms: [],
    confidence: 0.95,
    identity_confidence: 0.85,
    evidence_confidence: { visible_text: 0.95 },
    ...overrides,
  };
}

test('retrieval and visible summary are derived from the same grounded identity evidence', () => {
  const intent = buildScoopIntent({ object: description() }, true);
  assert.match(intent.summary.title, /DURANT/i);
  assert.match(intent.summary.title, /7/);
  assert.ok(intent.queries.some((query) => /DURANT/i.test(query.query) && /\b7\b/.test(query.query)));
});

test('multi-word grounded visible text survives both intent summary and retrieval', () => {
  const intent = buildScoopIntent({ object: description({
    subcategory: 't-shirt',
    color: 'black',
    visible_text: ['MINNESOTA GREY DUCK'],
    logos_markings: [],
  }) }, true);
  assert.match(intent.summary.title, /MINNESOTA GREY DUCK/i);
  assert.ok(intent.queries.some((query) => /MINNESOTA GREY DUCK/i.test(query.query)));
});

test('ungrounded OCR-like text does not become canonical visible intent text', () => {
  const intent = buildScoopIntent({ object: description({
    visible_text: ['GUESS BRAND'],
    evidence_confidence: { visible_text: 0.4 },
  }) }, true);
  assert.doesNotMatch(intent.summary.title, /GUESS BRAND/i);
});

test('ScoopResolver exposes one resolve boundary around Evidence -> Intent -> resolution', async () => {
  const resolver = new ScoopResolver(async ({ evidence, intent }) => ({
    query: intent.queries[0],
    category: evidence.object.category,
  }));
  const result = await resolver.resolve({ evidence: { object: description() }, visible_text_first: true });
  assert.equal(result.resolution.category, 'apparel');
  assert.equal(result.resolution.query.query, result.intent.queries[0].query);
});
