import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
const background = await readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const description = { category: 'drinkware', subcategory: 'mug', brand_candidate: null, model_candidate: null,
  color: 'red', material: 'ceramic', style_attributes: ['plain'], visible_text: [], logos_markings: [], distinctive_features: [], hardware_details: [], shape_silhouette: [], search_terms: ['red mug'], confidence: 0.85, identity_confidence: 0 };
const commerce = { query: { query: 'red mug' }, products: [], latency_ms: 12 };

async function run({ visionStatus = 200, visionPayload = description, commerceStatus = 200, commercePayload = commerce } = {}) {
  let listener;
  let requests = 0;
  const nodes = new Map();
  const element = () => ({ style: {}, children: [], appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); },
    append(...children) { for (const child of children) this.appendChild(child); },
    get firstElementChild() { return this.children[0]; }, addEventListener() {}, remove() { nodes.delete(this.id); } });
  const browser = { action: { onClicked: { addListener() {} } }, runtime: {
    onMessage: { addListener(fn) { listener = fn; } },
    async sendMessage(message) {
      return await listener(message, { tab: { id: 1 }, frameId: 0 });
    },
  } };
  const context = vm.createContext({ exports: {}, browser, defineBackground: fn => fn(), console,
    crypto: { randomUUID: () => 'regression-request' },
    location: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/watch?v=test' },
    document: { title: 'Test Video - YouTube', querySelector: () => null, createElement: element, getElementById: id => nodes.get(id), documentElement: element() },
    fetch: async (url) => {
      requests++;
      await new Promise(resolve => setTimeout(resolve, 2));
      const commerceRequest = String(url).includes('/resolve-products');
      return Response.json(commerceRequest ? commercePayload : visionPayload, { status: commerceRequest ? commerceStatus : visionStatus });
    },
  });
  vm.runInContext(compile(background), context);
  vm.runInContext(compile(content.slice(content.indexOf('const OVERLAY_ID'), content.indexOf('function showOverlay'))), context);
  await vm.runInContext('showAnalysis({ok:true,dataUrl:"data:image/png;base64,test"})', context);
  await new Promise(resolve => setTimeout(resolve, 10));
  return { panel: nodes.get('vcl-capture-result'), requests };
}

test('valid vision response continues through commerce resolution', async () => {
  const { panel, requests } = await run();
  assert.equal(panel.firstElementChild.textContent, 'VCL object understanding: success');
  assert.ok(panel.children.some(child => child.textContent === 'Commercially searchable confidence: 85%'));
  assert.ok(panel.children.some(child => child.textContent === 'Products · 0 · 12ms'));
  assert.equal(requests, 2);
});

test('background listener returns a promise-backed response instead of callback keepalive', async () => {
  let listener;
  const browser = { action: { onClicked: { addListener() {} } }, runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
  const context = vm.createContext({ exports: {}, browser, defineBackground: fn => fn(), console,
    fetch: async () => Response.json(description) });
  vm.runInContext(compile(background), context);
  const response = listener({ type: 'VCL_ANALYZE_SELECTION', requestId: 'promise-test', dataUrl: 'data:image/png;base64,test' }, { tab: { id: 1 }, frameId: 0 });
  assert.equal(typeof response?.then, 'function');
  assert.deepEqual(await response, description);
});

test('vision upstream error crosses promise boundary', async () => {
  const { panel, requests } = await run({ visionStatus: 500, visionPayload: { error: 'Provider unavailable' } });
  assert.ok(panel.children.some(child => child.textContent === 'Provider unavailable'));
  assert.equal(requests, 1);
});

test('commerce error does not erase successful object understanding', async () => {
  const { panel, requests } = await run({ commerceStatus: 503, commercePayload: { error: 'Missing EBAY_ACCESS_TOKEN' } });
  assert.equal(panel.firstElementChild.textContent, 'VCL object understanding: success');
  assert.ok(panel.children.some(child => child.textContent === 'Missing EBAY_ACCESS_TOKEN'));
  assert.equal(requests, 2);
});
