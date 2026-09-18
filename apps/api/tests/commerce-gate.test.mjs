import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const stripImports = (source) => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '');

const gateSource = await readFile(new URL('../src/commerce-gate.ts', import.meta.url), 'utf8');
const gateContext = vm.createContext({ exports: {} });
vm.runInContext(compile(stripImports(gateSource)), gateContext);
const { evaluateCommerceGate } = gateContext.exports;

const description = (overrides = {}) => ({
  category: '',
  subcategory: '',
  brand_candidate: null,
  model_candidate: null,
  color: '',
  material: '',
  style_attributes: [],
  visible_text: [],
  logos_markings: [],
  distinctive_features: [],
  hardware_details: [],
  shape_silhouette: [],
  search_terms: [],
  confidence: 0.9,
  identity_confidence: 0.9,
  ...overrides,
});

test('ALLOW: brand and model present', () => {
  const result = evaluateCommerceGate(description({
    category: 'Accessories',
    subcategory: 'Wristwatch',
    brand_candidate: 'Seiko',
    model_candidate: 'SKX007',
  }));
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.reason, 'brand_and_model_present');
});

test('ALLOW: brand in apparel category without model', () => {
  const result = evaluateCommerceGate(description({
    category: 'Apparel',
    subcategory: 'Jacket',
    brand_candidate: 'Patagonia',
  }));
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.reason, 'brand_in_commercial_category');
});

test('ALLOW: brand in shoes category', () => {
  const result = evaluateCommerceGate(description({
    category: 'Shoes',
    subcategory: 'Sneakers',
    brand_candidate: 'Adidas',
  }));
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.reason, 'brand_in_commercial_category');
});

test('ALLOW: brand in accessories category', () => {
  const result = evaluateCommerceGate(description({
    category: 'Accessories',
    subcategory: 'Handbag',
    brand_candidate: 'Coach',
  }));
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.reason, 'brand_in_commercial_category');
});

test('RESTRICT: no brand, no model', () => {
  const result = evaluateCommerceGate(description({
    category: 'Apparel',
    subcategory: 'Jacket',
  }));
  assert.equal(result.decision, 'RESTRICT');
  assert.equal(result.reason, 'incomplete_identity_evidence');
});

test('RESTRICT: brand present but non-commercial category', () => {
  const result = evaluateCommerceGate(description({
    category: 'Home Decor',
    subcategory: 'Lamp',
    brand_candidate: 'IKEA',
  }));
  assert.equal(result.decision, 'RESTRICT');
  assert.equal(result.reason, 'incomplete_identity_evidence');
});

test('REJECT: graphic art category', () => {
  const result = evaluateCommerceGate(description({
    category: 'Graphic art',
    subcategory: 'Illustration',
  }));
  assert.equal(result.decision, 'REJECT');
  assert.equal(result.reason, 'non_product_visual_class');
});

test('REJECT: illustration subcategory', () => {
  const result = evaluateCommerceGate(description({
    category: 'Art',
    subcategory: 'Illustration',
  }));
  assert.equal(result.decision, 'REJECT');
  assert.equal(result.reason, 'non_product_visual_class');
});

test('REJECT: packaging evidence with cardboard and carrying handle', () => {
  const result = evaluateCommerceGate(description({
    category: 'Home Decor',
    subcategory: 'Storage Box',
    style_attributes: ['cardboard', 'carrying handle', 'graphic'],
  }));
  assert.equal(result.decision, 'REJECT');
  assert.equal(result.reason, 'packaging_evidence');
});

test('REJECT: packaging evidence with cardboard and number print', () => {
  const result = evaluateCommerceGate(description({
    category: 'Home Decor',
    subcategory: 'Storage Box',
    distinctive_features: ['cardboard', 'number print'],
  }));
  assert.equal(result.decision, 'REJECT');
  assert.equal(result.reason, 'packaging_evidence');
});

test('RESTRICT: cardboard without packaging signals is not rejected', () => {
  const result = evaluateCommerceGate(description({
    category: 'Home Decor',
    subcategory: 'Storage Box',
    style_attributes: ['cardboard', 'rectangular'],
  }));
  assert.equal(result.decision, 'RESTRICT');
  assert.equal(result.reason, 'incomplete_identity_evidence');
});

test('case insensitive: Graphic Art matches graphic art', () => {
  const result = evaluateCommerceGate(description({
    category: 'Graphic Art',
    subcategory: 'Poster',
  }));
  assert.equal(result.decision, 'REJECT');
  assert.equal(result.reason, 'non_product_visual_class');
});

test('brand in non-eligible category with model still ALLOW', () => {
  const result = evaluateCommerceGate(description({
    category: 'Electronics',
    subcategory: 'Headphones',
    brand_candidate: 'Sony',
    model_candidate: 'WH-1000XM5',
  }));
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.reason, 'brand_and_model_present');
});
