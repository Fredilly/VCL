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
  const element = () => ({ style: {}, children: [], listeners: new Map(), attributes: {}, appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); },
    append(...children) { for (const child of children) this.appendChild(child); },
    get firstElementChild() { return this.children[0]; }, addEventListener(type, fn) { this.listeners.set(type, fn); },
    setAttribute(name, value) { this.attributes[name] = value; }, remove() { nodes.delete(this.id); } });
  const storageState = {};
  const browser = { action: { onClicked: { addListener() {} } }, commands: { onCommand: { addListener() {} } }, tabs: { query: async () => [], sendMessage: async () => undefined },
    storage: { local: { get: async (key) => ({ [key]: storageState[key] }), set: async (value) => Object.assign(storageState, value) } }, runtime: {
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
  assert.equal(panel.firstElementChild.textContent, 'Scoop found this');
  assert.ok(panel.children.some(child => child.textContent === 'Commercially searchable confidence: 85%'));
  assert.ok(panel.children.some(child => child.textContent === 'Products · 0 · 0s'));
  assert.equal(requests, 2);
  assert.equal(requestBodies[1].source_image, requestBodies[0].dataUrl, 'the same selected crop reaches candidate verification');
});

test('targeted analysis sends the exact user-approved crop directly to vision and commerce', async () => {
  const { requestBodies, requests } = await run({ targeted: true });
  assert.equal(requests, 2);
  assert.equal(requestBodies[0].dataUrl, 'data:image/png;base64,test');
  assert.equal(requestBodies[0].focusDataUrl, undefined);
  assert.deepEqual(requestBodies[0].point, { x: 0.75, y: 0.25 });
  assert.equal(requestBodies[1].source_image, 'data:image/png;base64,test');
});

test('background listener delivers callback response and returns true to keep channel open', async () => {
  let listener;
  const storageState = {};
  const browser = { action: { onClicked: { addListener() {} } }, commands: { onCommand: { addListener() {} } }, tabs: { query: async () => [], sendMessage: async () => undefined },
    storage: { local: { get: async (key) => ({ [key]: storageState[key] }), set: async (value) => Object.assign(storageState, value) } },
    runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
  const context = vm.createContext({ exports: {}, browser, defineBackground: fn => fn(), console, crypto: { randomUUID: () => '123e4567-e89b-12d3-a456-426614174000' },
    fetch: async () => Response.json(description) });
  vm.runInContext(compile(background), context);
  let response;
  const keepChannelOpen = listener({ type: 'VCL_ANALYZE_SELECTION', requestId: 'callback-test', dataUrl: 'data:image/png;base64,test' }, { tab: { id: 1 }, frameId: 0 }, value => { response = value; });
  assert.equal(keepChannelOpen, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(response, description);
});

test('vision provider failure is shown as temporary and recoverable', async () => {
  const { panel, requests } = await run({ visionStatus: 502, visionPayload: { error: 'Object analysis is temporarily unavailable', reason: 'PROVIDER_ERROR' } });
  assert.ok(panel.children.some(child => child.textContent === 'Scoop is temporarily unavailable. Try again in a moment.'));
  assert.equal(requests, 1);
});

test('commerce provider failure does not erase successful object understanding', async () => {
  const { panel, requests } = await run({ commerceStatus: 503, commercePayload: { error: 'Shopping sources are temporarily unavailable', reason: 'NO_CONFIGURED_PROVIDER' } });
  assert.equal(panel.firstElementChild.textContent, 'Scoop found this');
  assert.ok(panel.children.some(child => child.textContent === 'Scoop is temporarily unavailable. Try again in a moment.'));
  assert.equal(requests, 2);
});

test('true no-results stays distinct from provider failure', async () => {
  const { panel, requests } = await run({ commerceStatus: 200, commercePayload: { ...commerce, state: 'NO_RESULTS', failure_state: 'NO_RESULTS', retryable: false } });
  assert.equal(requests, 2);
  assert.ok(panel.children.some(child => child.textContent === 'No useful product candidates returned.'));
  assert.ok(!panel.children.some(child => child.textContent?.includes('temporarily unavailable')));
});

test('a complete high-confidence identity can send nearby evidence without changing the selected target or confidence', async () => {
  const complete = { ...description, brand_candidate: 'Example', model_candidate: 'M1', confidence: 0.99, identity_confidence: 0.99 };
  const { panel, requestBodies, requests } = await run({ targeted: true, visionPayload: complete, improve: true });
  assert.equal(requests, 3);
  const nearby = requestBodies.at(-1);
  assert.equal(nearby.dataUrl, 'data:image/png;base64,test');
  assert.deepEqual(nearby.point, { x: 0.75, y: 0.25 });
  assert.equal(nearby.nearby_frames.length, 1);
  assert.equal(nearby.nearby_frames[0].dataUrl, 'neighbor-pixels');
  assert.equal(nearby.primary_description.identity_confidence, 0.99);
  assert.equal(nearby.primary_description.subcategory, 'mug');
  assert.ok(panel.children.some(child => child.textContent === 'Identity confidence: 99%'));
  assert.ok(panel.children.some(child => child.textContent === 'Nearby evidence did not change the selected-object hypothesis.'));
});


test('feedback messages are forwarded to the feedback endpoint', async () => {
  let listener;
  let seen;
  const storageState = {};
  const browser = { action: { onClicked: { addListener() {} } }, commands: { onCommand: { addListener() {} } }, tabs: { query: async () => [], sendMessage: async () => undefined },
    storage: { local: { get: async (key) => ({ [key]: storageState[key] }), set: async (value) => Object.assign(storageState, value) } }, runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
  const context = vm.createContext({ exports: {}, browser, defineBackground: fn => fn(), console, crypto: { randomUUID: () => '123e4567-e89b-12d3-a456-426614174000' },
    fetch: async (url, options) => { seen = { url: String(url), body: JSON.parse(options.body) }; return Response.json({ accepted: true, event_id: 'evt-1' }); } });
  vm.runInContext(compile(background), context);
  let response;
  const keepChannelOpen = listener({ type: 'VCL_FEEDBACK', event_id: 'evt-1', result_id: 'result-1', feedback_type: 'correct_match' }, {}, value => { response = value; });
  assert.equal(keepChannelOpen, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(seen.url.endsWith('/feedback'));
  assert.deepEqual(seen.body, { event_id: 'evt-1', result_id: 'result-1', feedback_type: 'correct_match' });
  assert.equal(response.accepted, true);
});


test('macOS admin shortcut uses physical KeyA instead of localized Option+A character', () => {
  assert.match(content, /event\.altKey && event\.shiftKey && event\.code === 'KeyA'/);
  assert.doesNotMatch(content, /event\.key\.toLowerCase\(\) === 'a'/);
});


test('admin controls use per-admin session tokens and can promote non-EXACT candidates', () => {
  assert.match(background, /scoop_admin_session/);
  assert.match(background, /\/admin\/auth/);
  assert.match(background, /X-Scoop-Admin-Session/);
  assert.match(content, /if \(admin\?\.admin && adminPayload\)/);
  assert.doesNotMatch(content, /admin\?\.admin && product\.result_class === 'EXACT'/);
  assert.match(content, /VCL_ADMIN_CREATE_INVITE/);
});


test('feedback UI uses reversible selected thumbs without thank-you copy', () => {
  assert.match(content, /aria-pressed/);
  assert.match(content, /selectedFeedback === 'correct_match'/);
  assert.match(content, /selectedFeedback === 'wrong_item'/);
  assert.doesNotMatch(content, /Thanks — this helps Scoop learn/);
});


test('product feedback and verify controls stay inside their product card', () => {
  assert.match(content, /const card = document\.createElement\('div'\)/);
  assert.match(content, /card\.appendChild\(row\)/);
  assert.match(content, /card\.appendChild\(feedback\)/);
  assert.match(content, /panel\.appendChild\(card\)/);
  assert.doesNotMatch(content, /panel\.appendChild\(feedback\)/);
  assert.doesNotMatch(content, /Object\.assign\(feedback\.style,[\s\S]*?margin:\s*'-/);
});


test('verified result UI uses one exact-match badge and concise evidence copy without SKU/admin jargon', () => {
  assert.match(content, /exactBadge\.textContent = '✓ Exact match'/);
  assert.match(content, /Matched from visible text and shirt details/);
  assert.doesNotMatch(content, /Scoop Verified/);
  assert.doesNotMatch(content, /SKU \$\{verifiedProduct\.model\}/);
  assert.doesNotMatch(content, /Identity source: verified product data/);
});


test('verified offer rows keep merchant name without redundant verified labels', () => {
  assert.match(content, /product\.provider\.toLowerCase\(\) === 'ebay' \? 'eBay' : product\.provider/);
  assert.doesNotMatch(content, /verifiedLabel\.textContent = 'Scoop Verified'/);
});


test('YouTube Shorts surface context keeps a stable content_ref for exact verification', () => {
  const context = vm.createContext({
    exports: {},
    crypto: { randomUUID: () => 'shorts-context-test' },
    location: {
      hostname: 'www.youtube.com',
      search: '',
      pathname: '/shorts/J9Vx9RhSetM',
    },
    document: {
      title: 'Short title - YouTube',
      querySelector: () => null,
    },
  });
  vm.runInContext(compile(content.slice(content.indexOf('const OVERLAY_ID'), content.indexOf('function removeOverlay'))), context);
  const value = vm.runInContext('surfaceContext(12)', context);
  assert.equal(value.content_ref, 'youtube:J9Vx9RhSetM');
  assert.equal(value.timestamp_ms, 12000);
});


test('verified rows show their source and omit feedback/admin controls', () => {
  assert.match(content, /function productSourceLabel\(product: ProductCandidate\)/);
  assert.match(content, /return new URL\(product\.destination\)\.hostname\.replace/);
  assert.match(content, /if \(!isScoopVerified\) \{/);
  assert.doesNotMatch(content, /verifiedLabel\.textContent = 'Scoop Verified'/);
});
