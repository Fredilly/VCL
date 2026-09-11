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
  color: 'red', material: 'ceramic', style_attributes: ['plain'], search_terms: ['red mug'], confidence: 0.85 };

async function run(status, payload, closeEarly = false) {
  let listener;
  let requests = 0;
  const logs = [];
  const nodes = new Map();
  const element = () => ({ style: {}, children: [], appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); },
    get firstElementChild() { return this.children[0]; }, addEventListener() {}, remove() { nodes.delete(this.id); } });
  const browser = { action: { onClicked: { addListener() {} } }, runtime: {
    onMessage: { addListener(fn) { listener = fn; } },
    sendMessage(message) {
      return new Promise((resolve) => {
        let open = true;
        const keepAlive = listener(message, { tab: { id: 1 }, frameId: 0 }, value => { if (open) resolve(value); });
        if (keepAlive !== true || closeEarly) { open = false; resolve(undefined); }
      });
    },
  } };
  const context = vm.createContext({ exports: {}, browser, defineBackground: fn => fn(),
    console: { debug: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    crypto: { randomUUID: () => 'regression-request' },
    document: { createElement: element, getElementById: id => nodes.get(id), documentElement: element() },
    fetch: async () => { requests++; await new Promise(resolve => setTimeout(resolve, 5)); return Response.json(payload, { status }); },
  });
  vm.runInContext(compile(background), context);
  // Execute the real renderer and validator; exclude only the capture import and registration.
  vm.runInContext(compile(content.slice(content.indexOf('const OVERLAY_ID'), content.indexOf('function showOverlay'))), context);
  await vm.runInContext('showAnalysis({ok:true,dataUrl:"data:image/png;base64,test"})', context);
  return { panel: nodes.get('vcl-capture-result'), requests, logs };
}

test('HTTP 200 -> native callback messaging -> real overlay success', async () => {
  const { panel, requests, logs } = await run(200, description);
  assert.equal(panel.firstElementChild.textContent, 'VCL object understanding: success');
  assert.ok(panel.children.some(child => child.textContent === 'Commercially searchable confidence: 85%'));
  assert.equal(requests, 1);
  assert.ok(logs.some(row => row[0].includes('received') && row[3] === JSON.stringify(description)));
});

test('premature channel closure reproduces the reported validation error', async () => {
  const { panel } = await run(200, description, true);
  assert.equal(panel.firstElementChild.textContent, 'VCL object understanding: failed');
  assert.ok(panel.children.some(child => child.textContent === 'Vision provider returned an invalid response'));
});

test('upstream error crosses callback boundary with its original message', async () => {
  const { panel } = await run(500, { error: 'Provider unavailable' });
  assert.equal(panel.firstElementChild.textContent, 'VCL object understanding: failed');
  assert.ok(panel.children.some(child => child.textContent === 'Provider unavailable'));
});

test('unexpected response wrapping remains rejected and logged', async () => {
  const { panel, logs } = await run(200, { data: description });
  assert.equal(panel.firstElementChild.textContent, 'VCL object understanding: failed');
  assert.ok(logs.some(row => row[0].includes('validation rejected')));
});
