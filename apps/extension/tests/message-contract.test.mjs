import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
const background = await readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const compile = (source) => ts.transpileModule(source.replace(/__VCL_DEBUG_PROVENANCE__/g, 'false'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const description = { category: 'drinkware', subcategory: 'mug', brand_candidate: null, model_candidate: null,
  color: 'red', material: 'ceramic', style_attributes: ['plain'], visible_text: [], logos_markings: [], distinctive_features: [], hardware_details: [], shape_silhouette: [], search_terms: ['red mug'], confidence: 0.85, identity_confidence: 0 };
const commerce = { query: { query: 'red mug' }, products: [], latency_ms: 12 };

async function run({ visionStatus = 200, visionPayload = description, commerceStatus = 200, commercePayload = commerce, targeted = false, locateFails = false, improve = false } = {}) {
  let listener;
  let requests = 0;
  const requestBodies = [];
  const nodes = new Map();
  const element = () => ({ style: {}, children: [], listeners: new Map(), appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); },
    append(...children) { for (const child of children) this.appendChild(child); },
    get firstElementChild() { return this.children[0]; }, addEventListener(type, fn) { this.listeners.set(type, fn); }, remove() { nodes.delete(this.id); } });
  const browser = { action: { onClicked: { addListener() {} } }, commands: { onCommand: { addListener() {} } }, tabs: { query: async () => [], sendMessage: async () => undefined }, runtime: {
    onMessage: { addListener(fn) { listener = fn; } },
    async sendMessage(message) {
      return await new Promise((resolve, reject) => {
        const keepChannelOpen = listener(message, { tab: { id: 1 }, frameId: 0 }, resolve);
        if (keepChannelOpen !== true) reject(new Error('Listener did not keep the channel open.'));
      });
    },
  } };
  const context = vm.createContext({ exports: {}, browser, defineBackground: fn => fn(), console, AbortController,
    nearbyCaptureLimitation: () => undefined,
    captureNearbyFrames: async () => ({ frames: [{ id: 'previous', timestamp: 9.5, offset: -0.5, dataUrl: 'neighbor-pixels' }], attempts: [{ id: 'previous', status: 'captured' }], mode: 'player', restored: true }),
    selectionPoint: () => ({ x: 0.75, y: 0.25 }), focusBox: () => 'focus', validatedTargetBox: () => 'target',
    cropFrozenSelection: async (selection, box) => ({ ...selection, dataUrl: box === 'focus' ? 'focus-pixels' : 'target-pixels' }),
    crypto: { randomUUID: () => 'regression-request' },
    location: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/watch?v=test' },
    document: { title: 'Test Video - YouTube', querySelector: () => null, createElement: element, getElementById: id => nodes.get(id), documentElement: element() },
    fetch: async (url, options) => {
      requests++;
      requestBodies.push(JSON.parse(options.body));
      await new Promise(resolve => setTimeout(resolve, 2));
      if (String(url).includes('/locate-selection')) return Response.json(locateFails ? { error: 'Adjust the crop' }
        : { x: 0.7, y: 0.2, width: 0.1, height: 0.1, confidence: 0.95 }, { status: locateFails ? 422 : 200 });
      const commerceRequest = String(url).includes('/resolve-products');
      return Response.json(commerceRequest ? commercePayload : visionPayload, { status: commerceRequest ? commerceStatus : visionStatus });
    },
  });
  vm.runInContext(compile(background), context);
  vm.runInContext(compile(content.slice(content.indexOf('const OVERLAY_ID'), content.indexOf('function showOverlay'))), context);
  await vm.runInContext(`showAnalysis({ok:true,dataUrl:"data:image/png;base64,test"${targeted ? ',crop:{}' : ''}})`, context);
  if (improve) {
    const action = nodes.get('vcl-capture-result').children.find(child => child.textContent === 'Improve with nearby frames');
    assert.ok(action, 'a complete primary identity must not block the explicit nearby-frame request');
    await action.listeners.get('click')();
  }
  await new Promise(resolve => setTimeout(resolve, 10));
  return { panel: nodes.get('vcl-capture-result'), requests, requestBodies };
}

test('valid vision response continues through commerce resolution', async () => {
  const { panel, requests, requestBodies } = await run();
  assert.equal(panel.firstElementChild.textContent, 'VCL object understanding: success');
  assert.ok(panel.children.some(child => child.textContent === 'Commercially searchable confidence: 85%'));
  assert.ok(panel.children.some(child => child.textContent === 'Products · 0 · 12ms'));
  assert.equal(requests, 2);
  assert.equal(requestBodies[1].source_image, requestBodies[0].dataUrl, 'the same selected crop reaches candidate verification');
});

test('click point and focus reach localization; only the isolated target reaches analysis and commerce', async () => {
  const { requestBodies, requests } = await run({ targeted: true });
  assert.equal(requests, 3);
  assert.deepEqual(requestBodies[0].point, { x: 0.75, y: 0.25 });
  assert.equal(requestBodies[0].focusDataUrl, 'focus-pixels');
  assert.equal(requestBodies[1].dataUrl, 'target-pixels');
  assert.deepEqual(requestBodies[1].point, { x: 0.75, y: 0.25 });
  assert.equal(requestBodies[2].source_image, 'target-pixels');
});

test('failed localization falls back non-blockingly and continues analysis', async () => {
  const { requests, requestBodies, panel } = await run({ targeted: true, locateFails: true });
  assert.equal(requests, 3);
  assert.equal(requestBodies[1].dataUrl, 'target-pixels');
  assert.equal(requestBodies[2].source_image, 'target-pixels');
  assert.equal(panel.firstElementChild.textContent, 'VCL object understanding: success');
});

test('background listener delivers callback response and returns true to keep channel open', async () => {
  let listener;
  const browser = { action: { onClicked: { addListener() {} } }, commands: { onCommand: { addListener() {} } }, tabs: { query: async () => [], sendMessage: async () => undefined }, runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
  const context = vm.createContext({ exports: {}, browser, defineBackground: fn => fn(), console,
    fetch: async () => Response.json(description) });
  vm.runInContext(compile(background), context);
  let response;
  const keepChannelOpen = listener({ type: 'VCL_ANALYZE_SELECTION', requestId: 'callback-test', dataUrl: 'data:image/png;base64,test' }, { tab: { id: 1 }, frameId: 0 }, value => { response = value; });
  assert.equal(keepChannelOpen, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(response, description);
});

test('vision upstream error crosses promise boundary as friendly UI copy', async () => {
  const { panel, requests } = await run({ visionStatus: 500, visionPayload: { error: 'Provider unavailable' } });
  assert.ok(panel.children.some(child => child.textContent === 'Something went wrong. Try again.'));
  assert.equal(requests, 1);
});

test('commerce error does not erase successful object understanding', async () => {
  const { panel, requests } = await run({ commerceStatus: 503, commercePayload: { error: 'Missing EBAY_ACCESS_TOKEN' } });
  assert.equal(panel.firstElementChild.textContent, 'VCL object understanding: success');
  assert.ok(panel.children.some(child => child.textContent === 'Scoop is temporarily busy. Try again in a moment.'));
  assert.equal(requests, 2);
});

test('a complete high-confidence identity can send nearby evidence without changing the selected target or confidence', async () => {
  const complete = { ...description, brand_candidate: 'Example', model_candidate: 'M1', confidence: 0.99, identity_confidence: 0.99 };
  const { panel, requestBodies, requests } = await run({ targeted: true, visionPayload: complete, improve: true });
  assert.equal(requests, 4);
  const nearby = requestBodies.at(-1);
  assert.equal(nearby.dataUrl, 'target-pixels');
  assert.deepEqual(nearby.point, { x: 0.75, y: 0.25 });
  assert.equal(nearby.nearby_frames.length, 1);
  assert.equal(nearby.nearby_frames[0].dataUrl, 'neighbor-pixels');
  assert.equal(nearby.primary_description.identity_confidence, 0.99);
  assert.equal(nearby.primary_description.subcategory, 'mug');
  assert.ok(panel.children.some(child => child.textContent === 'Identity confidence: 99%'));
  assert.ok(panel.children.some(child => child.textContent === 'Nearby evidence did not change the selected-object hypothesis.'));
});
