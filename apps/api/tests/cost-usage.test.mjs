import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const groqFile = fileURLToPath(new URL('../src/groq-vision.ts', import.meta.url));
const imagesFile = fileURLToPath(new URL('../src/candidate-images.ts', import.meta.url));
const image = 'data:image/png;base64,AAAA';

const description = {
  category: 'apparel', subcategory: 'Sweater', brand_candidate: null, model_candidate: null,
  color: 'navy', material: 'wool', style_attributes: ['crew neck'], visible_text: [], logos_markings: [],
  distinctive_features: [], hardware_details: [], shape_silhouette: ['crew neck'], search_terms: ['navy sweater'],
  confidence: 0.9, identity_confidence: 0,
};

test('Groq analysis exposes provider token usage without changing description fields', async () => {
  const fetch = async () => Response.json({
    choices: [{ message: { content: JSON.stringify(description) } }],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_time: 0.01, completion_time: 0.02, total_time: 0.03 },
  });
  const { GroqVisionProvider } = loadModule(groqFile, { fetch });
  const provider = new GroqVisionProvider('key');
  const result = await provider.analyzeSelection(image, { x: 0.5, y: 0.5 });
  assert.equal(result.subcategory, 'Sweater');
  assert.deepEqual(JSON.parse(JSON.stringify(result.provider_usage)), {
    provider: 'groq', model: 'qwen/qwen3.6-27b', requests: 1,
    prompt_tokens: 120, completion_tokens: 30, total_tokens: 150,
    prompt_time_ms: 10, completion_time_ms: 20, total_time_ms: 30,
  });
});

test('Groq localization exposes its own usage snapshot', async () => {
  const fetch = async () => Response.json({
    choices: [{ message: { content: JSON.stringify({ x: 0.25, y: 0.25, width: 0.5, height: 0.5, confidence: 0.95 }) } }],
    usage: { prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 },
  });
  const { GroqVisionProvider } = loadModule(groqFile, { fetch });
  const provider = new GroqVisionProvider('key');
  const result = await provider.locateSelection(image, image, { x: 0.5, y: 0.5 });
  assert.equal(result.confidence, 0.95);
  assert.equal(result.provider_usage.requests, 1);
  assert.equal(result.provider_usage.prompt_tokens, 200);
  assert.equal(result.provider_usage.completion_tokens, 20);
});

test('Gemini candidate verification exposes usageMetadata', async () => {
  const source = {
    category: { value: 'apparel', confidence: 0.95, basis: 'image' },
    subtype: { value: 'sweater', confidence: 0.95, basis: 'image' },
    gender: { value: null, confidence: 0, basis: 'image' }, age_group: { value: null, confidence: 0, basis: 'image' },
    color: { value: 'navy', confidence: 0.95, basis: 'image' }, sleeve: { value: 'long', confidence: 0.9, basis: 'image' },
    brand: { value: null, confidence: 0, basis: 'image' }, model: { value: null, confidence: 0, basis: 'image' },
    material: { value: 'wool', confidence: 0.8, basis: 'image' }, neckline: { value: 'crew', confidence: 0.8, basis: 'image' },
  };
  const candidateEvidence = { ...source, category: { value: 'apparel', confidence: 0.95, basis: 'metadata' }, subtype: { value: 'sweater', confidence: 0.95, basis: 'metadata' } };
  const fetch = async (url) => {
    if (!String(url).includes('generativelanguage')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    return Response.json({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ source, candidates: [{ index: 0, attributes: candidateEvidence, similarity: 0.9, confidence: 0.9, matching_details: [] }] }) }] } }],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 100, totalTokenCount: 1000 },
    });
  };
  const { compareCandidateImages, parseSourceImage } = loadModule(imagesFile, { fetch });
  const candidate = { id: '1', title: 'Navy Wool Sweater', brand: null, model: null, category: 'apparel', image_reference: 'https://cdn.example.com/a.png', provenance: 'test', destination: null, price: null, currency: null, result_class: 'SIMILAR' };
  const result = await compareCandidateImages('key', 'gemini-3.5-flash-lite', parseSourceImage(image), description, [candidate]);
  assert.equal(result.compared, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.usage)), {
    provider: 'gemini', model: 'gemini-3.5-flash-lite', requests: 1,
    prompt_tokens: 900, completion_tokens: 100, total_tokens: 1000,
  });
});
