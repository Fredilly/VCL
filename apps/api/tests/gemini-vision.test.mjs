import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { GeminiVisionProvider } from '../dist/src/gemini-vision.js';

// Captured Worker error; the upstream 503 envelope is reconstructed for mocking.
const fixture = JSON.parse(await readFile(new URL('./fixtures/gemini-high-demand.json', import.meta.url)));
const expected = { category: 'cup', subcategory: 'mug', brand_candidate: null, model_candidate: null,
  color: 'red', material: 'ceramic', style_attributes: [], search_terms: ['red ceramic mug'], confidence: 0.9, identity_confidence: 0 };
const image = 'data:image/png;base64,aGVsbG8=';

test('uses the configured model without assuming the development model', async (t) => {
  let requestedUrl;
  t.mock.method(globalThis, 'fetch', async (url) => {
    requestedUrl = String(url);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(expected) }] } }] });
  });
  await new GeminiVisionProvider('test-key', 'gemini-2.5-flash-lite').analyzeSelection(image);
  assert.match(requestedUrl, /models\/gemini-2\.5-flash-lite:generateContent/);
  await new GeminiVisionProvider('test-key', 'gemini-3.6-flash').analyzeSelection(image);
  assert.match(requestedUrl, /models\/gemini-3\.6-flash:generateContent/);
});

test('recovers from the reported Gemini high-demand error', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return calls.length < 3
      ? Response.json({ error: { message: fixture.error, status: 'UNAVAILABLE', code: 503 } }, { status: 503 })
      : Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(expected) }] } }] });
  });
  assert.deepEqual(await new GeminiVisionProvider('test-key').analyzeSelection(image), expected);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], calls[2]);
});

test('stops after three attempts and preserves the reported error', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: { message: fixture.error } }, { status: 503 }));
  await assert.rejects(new GeminiVisionProvider('test-key').analyzeSelection(image), { message: fixture.error });
  assert.equal(mock.mock.callCount(), 3);
});

test('does not retry authentication errors', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: { message: 'Invalid API key' } }, { status: 403 }));
  await assert.rejects(new GeminiVisionProvider('test-key').analyzeSelection(image), { message: 'Invalid API key' });
  assert.equal(mock.mock.callCount(), 1);
});
