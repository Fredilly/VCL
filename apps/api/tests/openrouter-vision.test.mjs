import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouterVisionProvider } from '../dist/src/openrouter-vision.js';

const image = 'data:image/png;base64,aGVsbG8=';
const expected = {
  category: 'shoes', subcategory: 'sneaker', brand_candidate: 'Adidas', model_candidate: 'Samba OG',
  color: 'white', material: 'leather', style_attributes: [], visible_text: [], logos_markings: ['three stripes'],
  distinctive_features: [], hardware_details: ['laces'], shape_silhouette: ['low top'], search_terms: ['Adidas Samba OG white'],
  confidence: 0.95, identity_confidence: 0.92,
};

test('uses OpenRouter Gemini Flash Lite with image input and reports cost', async (t) => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url: String(url), options };
    return Response.json({
      model: 'google/gemini-2.5-flash-lite',
      choices: [{ message: { content: JSON.stringify(expected) } }],
      usage: { prompt_tokens: 1200, completion_tokens: 200, total_tokens: 1400, cost: 0.0002 },
    });
  });

  const result = await new OpenRouterVisionProvider('test-key').analyzeSelection(image);
  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, 'google/gemini-2.5-flash-lite');
  assert.equal(body.messages[0].content[1].image_url.url, image);
  assert.equal(result.brand_candidate, 'Adidas');
  assert.equal(result.provider_usage.provider, 'openrouter');
  assert.equal(result.provider_usage.cost_usd, 0.0002);
});

test('classifies exhausted OpenRouter credits as quota exhaustion', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: { message: 'Insufficient credits or balance' } }, { status: 429 }));
  await assert.rejects(new OpenRouterVisionProvider('test-key').analyzeSelection(image), { reason: 'QUOTA_EXHAUSTED' });
});
