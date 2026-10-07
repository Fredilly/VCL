import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const { persistAlphaLearning } = loadModule(new URL('../src/alpha-learning.ts', import.meta.url).pathname, { TextDecoder });

test('alpha learning persists reusable evidence and candidate relationships without raw frames', async () => {
  const writes = [];
  const env = {
    OPENROUTER_MODEL: 'google/gemini-2.5-flash-lite',
    FEEDBACK_LEDGER: {
      idFromName(name) { assert.equal(name, 'alpha-feedback-v1'); return name; },
      get() {
        return {
          async fetch(input, init) {
            writes.push({ path: new URL(input).pathname, body: JSON.parse(init.body) });
            return Response.json({ accepted: true });
          },
        };
      },
    },
  };
  await persistAlphaLearning({
    env,
    telemetry: { event_id: 'evt-1', session_id: 'session-1' },
    description: {
      category: 'fragrance',
      subcategory: 'perfume',
      brand_candidate: 'Creed',
      model_candidate: 'Aventus',
      color: 'black',
      material: 'glass',
      style_attributes: ['rectangular bottle'],
      visible_text: ['CREED', 'AVENTUS'],
      logos_markings: ['CREED'],
      distinctive_features: ['silver cap'],
      hardware_details: [],
      shape_silhouette: ['rectangular'],
      search_terms: ['Creed Aventus'],
      confidence: 0.9,
      identity_confidence: 0.8,
    },
    state: 'RESULTS',
    total_ms: 4200,
    products: [{
      id: 'candidate-1',
      title: 'Creed Aventus',
      brand: 'Creed',
      model: 'Aventus',
      category: 'fragrance',
      image_reference: null,
      provenance: 'brave',
      destination: 'https://merchant.example/item',
      price: '99',
      currency: 'USD',
      result_class: 'SIMILAR',
      provider: 'brave',
    }],
    query: {
      query: 'Creed Aventus perfume',
      category: 'fragrance',
      subcategory: 'perfume',
      brand: 'Creed',
      model: 'Aventus',
      attributes: [],
    },
    verification_usage: { cost_usd: 0.003 },
    commerce_calls: { brave: 1 },
    context: {
      platform: 'youtube',
      content_ref: 'youtube:test-video-123',
      timestamp_ms: 41821,
    },
  });

  assert.deepEqual(writes.map((write) => write.path).sort(), ['/context', '/scoop']);
  const learning = writes.find((write) => write.path === '/scoop').body;
  assert.equal(learning.category, 'fragrance');
  assert.equal(learning.brand, 'Creed');
  assert.deepEqual(learning.visible_text, ['CREED', 'AVENTUS']);
  assert.equal(learning.verification_cost_usd, 0.003);
  assert.equal(learning.platform, 'youtube');
  assert.equal(learning.content_ref, 'youtube:test-video-123');
  assert.equal(learning.timestamp_ms, 41821);
  assert.equal(JSON.stringify(learning).includes('data:image'), false);
  assert.equal(JSON.stringify(learning).includes('youtube.com'), false);
});
