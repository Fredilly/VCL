import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const image = 'data:image/png;base64,aGVsbG8=';
const description = {
  category: 'apparel',
  subcategory: 'jersey',
  brand_candidate: null,
  model_candidate: null,
  color: 'green',
  material: '',
  style_attributes: [],
  visible_text: ['BOSTON', '9'],
  logos_markings: [],
  distinctive_features: [],
  hardware_details: [],
  shape_silhouette: [],
  search_terms: ['Boston 9 green jersey'],
  confidence: 0.9,
  identity_confidence: 0,
};

test('Cloudflare vision fails fast on PROVIDER_ERROR so fallback is not delayed', async () => {
  let calls = 0;
  const ai = {
    async run() {
      calls++;
      throw new Error('transient malformed provider response');
    },
  };
  const { default: worker } = loadModule(new URL('../src/server.ts', import.meta.url).pathname, { TextDecoder });
  const response = await worker.fetch(
    new Request('https://api.test/analyze-selection', {
      method: 'POST',
      body: JSON.stringify({ dataUrl: image }),
    }),
    { VISION_PROVIDER: 'cloudflare', AI: ai },
  );
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(calls, 1);
  assert.deepEqual(payload.vision_routing, [
    { provider: 'cloudflare', status: 'FAILED', reason: 'PROVIDER_ERROR' },
  ]);
});

test('Cloudflare vision does not retry quota exhaustion', async () => {
  let calls = 0;
  const ai = {
    async run() {
      calls++;
      throw new Error('3036 free allocation used up');
    },
  };
  const { default: worker } = loadModule(new URL('../src/server.ts', import.meta.url).pathname, { TextDecoder });
  const response = await worker.fetch(
    new Request('https://api.test/analyze-selection', {
      method: 'POST',
      body: JSON.stringify({ dataUrl: image }),
    }),
    { VISION_PROVIDER: 'cloudflare', AI: ai },
  );
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(calls, 1);
  assert.deepEqual(payload.vision_routing, [
    { provider: 'cloudflare', status: 'FAILED', reason: 'QUOTA_EXHAUSTED' },
  ]);
});
