import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';
const image = 'data:image/png;base64,aGVsbG8=';
const point = { x: 0.72, y: 0.38 };
const target = { x: 0.68, y: 0.3, width: 0.08, height: 0.16, confidence: 0.95 };
let answer = target; const calls = [];
const worker = loadModule(new URL('../src/server.ts', import.meta.url).pathname, { TextDecoder,
  fetch: async (_url, options) => {
    const request = JSON.parse(options.body); calls.push(request);
    return Response.json(request.contents
      ? { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }
      : { choices: [{ message: { content: JSON.stringify(answer) } }] });
  },
}).default;
const post = (body, provider = 'gemini') => worker.fetch(new Request('https://api.test/locate-selection', {
  method: 'POST', body: JSON.stringify(body),
}), { VISION_PROVIDER: provider, GEMINI_API_KEY: 'test', GROQ_API_KEY: 'test' });

test('both vision adapters use exact click coordinates and two-scale images to locate the target', async () => {
  for (const provider of ['gemini', 'groq']) {
    calls.length = 0;
    const response = await post({ dataUrl: image, focusDataUrl: image, point }, provider);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), target);
    const request = calls[0];
    if (provider === 'gemini') assert.deepEqual(request.generationConfig.responseJsonSchema.required, ['x', 'y', 'width', 'height', 'confidence']);
    const parts = request.contents?.[0].parts ?? request.messages[0].content;
    assert.equal(parts.length, 3);
    assert.match(parts[0].text, /x=0.7200, y=0.3800/);
    assert.match(parts[0].text, /primary targeting signal/);
    assert.match(parts[0].text, /entire visible extent/);
  }
});

test('missing/invalid click and external focus images are rejected before provider calls', async () => {
  calls.length = 0;
  for (const body of [{ dataUrl: image, focusDataUrl: image }, { dataUrl: image, focusDataUrl: image, point: { x: 2, y: 0 } },
    { dataUrl: image, point, focusDataUrl: 'https://other.test/image.jpg' }]) assert.equal((await post(body)).status, 400);
  assert.equal(calls.length, 0);
});

test('a confident box for another object and an ambiguous box fail without returning image bytes', async () => {
  for (const invalid of [{ ...target, x: 0.1 }, { ...target, confidence: 0.6 }, { ...target, width: 2 }]) {
    answer = invalid;
    const response = await post({ dataUrl: image, focusDataUrl: image, point });
    assert.equal(response.status, 422);
    assert.doesNotMatch(await response.text(), /data:image/);
  }
  answer = target;
});
