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

test('Cloudflare vision retries one PROVIDER_ERROR before falling back', async () => {
  let calls = 0;
  const ai = {
    async run(_model, input) {
      calls++;
      if (calls === 1) throw new Error('transient malformed provider response');
      return { response: JSON.stringify(description) };
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
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(calls, 2);
  assert.deepEqual(payload.vision_routing, [
    { provider: 'cloudflare', status: 'FAILED', reason: 'PROVIDER_ERROR' },
    { provider: 'cloudflare', status: 'SUCCESS' },
  ]);
  assert.equal(payload.subcategory, 'jersey');
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

test('generic Cloudflare provider errors do not open the cooldown circuit', async () => {
  let calls = 0;
  const ai = {
    async run() {
      calls++;
      if (calls <= 2) throw new Error('transient malformed provider response');
      return { response: JSON.stringify(description) };
    },
  };
  const { default: worker } = loadModule(new URL('../src/server.ts', import.meta.url).pathname, { TextDecoder });

  const first = await worker.fetch(
    new Request('https://api.test/analyze-selection', {
      method: 'POST',
      body: JSON.stringify({ dataUrl: image }),
    }),
    { VISION_PROVIDER: 'cloudflare', AI: ai },
  );
  assert.equal(first.status, 502);

  const second = await worker.fetch(
    new Request('https://api.test/analyze-selection', {
      method: 'POST',
      body: JSON.stringify({ dataUrl: image }),
    }),
    { VISION_PROVIDER: 'cloudflare', AI: ai },
  );
  assert.equal(second.status, 200);
  assert.equal(calls, 3);
});
