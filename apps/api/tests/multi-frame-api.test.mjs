import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';
const image = 'data:image/png;base64,aGVsbG8=';
const description = { category: 'bottle', subcategory: 'water bottle', brand_candidate: null, model_candidate: null, color: 'blue',
  material: '', style_attributes: [], visible_text: [], logos_markings: [], distinctive_features: [], hardware_details: [], shape_silhouette: [],
  search_terms: ['blue water bottle'], confidence: 0.9, identity_confidence: 0 };
const nearby = { description: { ...description, visible_text: ['750 ml'], evidence_confidence: { visible_text: 0.95 } }, same_object_confidence: 0.99, identity_support: false };
const calls = [];
let fail = false;
const { default: worker } = loadModule(new URL('../src/server.ts', import.meta.url).pathname, { TextDecoder,
  fetch: async (url, options) => {
    const request = JSON.parse(options.body); calls.push(request);
    if (fail) throw new Error('RAW_IMAGE_SHOULD_NOT_LEAK');
    const parts = request.contents?.[0].parts;
    const value = (parts ? parts.filter(p => p.inlineData).length : request.messages[0].content.filter(p => p.image_url).length) === 2 ? nearby : description;
    return Response.json(parts ? { candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] } : { choices: [{ message: { content: JSON.stringify(value) } }] });
  },
});
const post = (body, provider = 'gemini') => worker.fetch(new Request('https://api.test/analyze-selection', { method: 'POST', body: JSON.stringify(body) }),
  { VISION_PROVIDER: provider, GEMINI_API_KEY: 'test', GROQ_API_KEY: 'test' });

test('legacy single-frame API shape is unchanged and response is not cacheable', async () => {
  const response = await post({ dataUrl: image });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  const { vision_routing, ...legacy } = result;
  assert.deepEqual(legacy, description);
  assert.deepEqual(vision_routing, [{ provider: 'gemini', status: 'SUCCESS' }]);
});

test('both adapters send primary first and a single nearby crop per comparison', async () => {
  for (const provider of ['gemini', 'groq']) {
    calls.length = 0;
    const response = await post({ dataUrl: image, timestamp: 10, primary_description: description, point: { x: 0.3, y: 0.7 },
      nearby_frames: [{ id: 'next', timestamp: 10.5, offset: 0.5, dataUrl: 'data:image/png;base64,bmV4dA==' }] }, provider);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.visible_text, ['750 ml']);
    assert.equal(result.multi_frame.frames_used, 2);
    assert.equal(result.multi_frame.field_sources.visible_text, 'next');
    assert.equal(calls.length, 1, 'primary analysis is reused');
    assert.match((calls[0].contents?.[0].parts ?? calls[0].messages[0].content)[0].text, /x=0.3000, y=0.7000/);
    if (provider === 'gemini') assert.deepEqual(calls[0].contents[0].parts.filter(p => p.inlineData).map(p => p.inlineData.data), ['aGVsbG8=', 'bmV4dA==']);
    else assert.deepEqual(calls[0].messages[0].content.filter(p => p.image_url).map(p => p.image_url.url), [image, 'data:image/png;base64,bmV4dA==']);
    assert.doesNotMatch(JSON.stringify(result), /data:image|inlineData/);
  }
});

test('single-frame analysis retains the click anchor inside the refined crop', async () => {
  calls.length = 0;
  const response = await post({ dataUrl: image, point: { x: 0.2, y: 0.8 } });
  assert.equal(response.status, 200);
  assert.match(calls[0].contents[0].parts[0].text, /x=0.2000, y=0.8000/);
  assert.match(calls[0].contents[0].parts[0].text, /Surrounding objects/);
});

test('nearby provider errors preserve the baseline and never return raw provider payloads', async () => {
  fail = true;
  try {
    const result = await (await post({ dataUrl: image, timestamp: 10, primary_description: description,
      nearby_frames: [{ id: 'next', timestamp: 10.5, offset: 0.5, dataUrl: image }] })).json();
    assert.equal(result.multi_frame.changed_hypothesis, false);
    assert.equal(result.multi_frame.frames_used, 1);
    assert.doesNotMatch(JSON.stringify(result), /RAW_IMAGE/);
  } finally { fail = false; }
});

test('malformed multi-frame requests are rejected before vision calls', async () => {
  calls.length = 0;
  for (const body of [{ dataUrl: image, nearby_frames: [] }, { dataUrl: image, timestamp: -1 },
    { dataUrl: image, timestamp: 1, primary_description: description, nearby_frames: [{ id: 'next', offset: 5, timestamp: 6, dataUrl: image }] }]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('actual oversized request body is bounded even without Content-Length', async () => {
  const response = await worker.fetch(new Request('https://api.test/analyze-selection', { method: 'POST', body: ' '.repeat(8_500_001) }), {});
  assert.equal(response.status, 400);
});

test('explicit nearby frames reach both adapters even when primary identity is complete', async () => {
  const complete = { ...description, brand_candidate: 'Example', model_candidate: 'M1', identity_confidence: 0.99 };
  for (const provider of ['gemini', 'groq']) {
    calls.length = 0;
    const result = await (await post({ dataUrl: image, timestamp: 10, primary_description: complete,
      nearby_frames: [{ id: 'next', timestamp: 10.5, offset: 0.5, dataUrl: image }] }, provider)).json();
    assert.equal(calls.length, 1, 'the explicit request must not be silently skipped');
    assert.equal(result.multi_frame.frames_used, 2);
    assert.deepEqual(result.visible_text, ['750 ml']);
    assert.equal(result.multi_frame.field_sources.visible_text, 'next');
    assert.equal(result.brand_candidate, complete.brand_candidate);
    assert.equal(result.model_candidate, complete.model_candidate);
    assert.equal(result.identity_confidence, complete.identity_confidence);
    assert.equal(result.confidence, complete.confidence);
  }
});
