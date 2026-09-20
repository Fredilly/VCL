import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const { routeWithJev, routerInput } = loadModule(new URL('../src/jev-router.ts', import.meta.url).pathname);
const { VercelJevBinding } = loadModule(new URL('../src/vercel-jev.ts', import.meta.url).pathname);
const { resolveJevBinding } = loadModule(new URL('../src/jev-binding.ts', import.meta.url).pathname);
const evidence = { category: 'watch', subcategory: 'digital watch', confidence: 0.95, identity_confidence: 0.9, visible_text: ['CASIO'], logos_markings: ['CASIO'], distinctive_features: ['black resin band'] };

function ai(response, error) {
  return { async run() { if (error) throw error; return response; } };
}

for (const [commerce_action, verification_action, multiframe_action] of [
  ['SKIP', 'FULL', 'NO'], ['SEARCH_NORMAL', 'LIGHT', 'NO'], ['SEARCH_BROAD', 'FULL', 'ESCALATE'],
]) test(`valid Jev response routes ${commerce_action}/${verification_action}/${multiframe_action}`, async () => {
  const result = await routeWithJev(routerInput(evidence, true, 2), ai({ commerce_action, verification_action, multiframe_action }));
  assert.deepEqual(result.decision, { commerce_action, verification_action, multiframe_action });
  assert.equal(result.telemetry.failed, false);
  assert.equal(result.telemetry.request_schema_version, 'jev-state-questions-v1');
});

test('parses Cloudflare Jev answers.<question>.choice response shape', async () => {
  const result = await routeWithJev(routerInput(evidence, true, 2), ai({
    model: 'jev-1.13.0',
    answers: {
      commerce_action: { type: 'choice', choice: 'SEARCH_BROAD', confidence: 0.8, probabilities: {} },
      verification_action: { type: 'choice', choice: 'LIGHT', confidence: 0.9, probabilities: {} },
      multiframe_action: { type: 'choice', choice: 'ESCALATE', confidence: 0.7, probabilities: {} },
    },
    usage: { input_tokens: 321, output_tokens: 42 },
  }));
  assert.equal(result.decision.commerce_action, 'SEARCH_BROAD');
  assert.equal(result.decision.verification_action, 'LIGHT');
  assert.equal(result.decision.multiframe_action, 'ESCALATE');
  assert.equal(result.telemetry.failed, false);
  assert.equal(result.telemetry.input_tokens, 321);
  assert.equal(result.telemetry.output_tokens, 42);
});

test('malformed response fails open and records sanitized response shape', async () => {
  const result = await routeWithJev(routerInput(evidence, false, 1), ai({ result_class: 'EXACT', commerce_action: 'SKIP' }));
  assert.equal(result.decision.commerce_action, 'SEARCH_NORMAL');
  assert.equal(result.decision.verification_action, 'FULL');
  assert.equal(result.decision.multiframe_action, 'NO');
  assert.equal(result.telemetry.failed, true);
  assert.equal(result.telemetry.failure_kind, 'malformed_response');
  assert.match(result.telemetry.response_shape ?? '', /result_class:string/);
});

test('Workers AI error fails open and records upstream diagnostics', async () => {
  const error = Object.assign(new Error('AI unavailable'), { status: 503, code: 'UPSTREAM_UNAVAILABLE' });
  const result = await routeWithJev(routerInput(evidence, false, 1), ai(null, error));
  assert.equal(result.telemetry.failed, true);
  assert.equal(result.telemetry.failure_kind, 'upstream_error');
  assert.equal(result.telemetry.failure_message, 'AI unavailable');
  assert.equal(result.telemetry.http_status, 503);
  assert.equal(result.telemetry.error_code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(result.decision.verification_action, 'FULL');
});

test('timeout fails open and is classified', async () => {
  const result = await routeWithJev(routerInput(evidence, false, 1), { async run() { return new Promise(() => {}); } }, 5);
  assert.equal(result.telemetry.failed, true);
  assert.equal(result.telemetry.failure_kind, 'timeout');
  assert.equal(result.decision.commerce_action, 'SEARCH_NORMAL');
});

test('router input excludes identity classes and commercial/provider payout data', () => {
  const input = routerInput({ ...evidence, brand_candidate: 'CASIO', model_candidate: 'F-91W', search_terms: ['watch'], provider_usage: { provider: 'x', model: 'y', requests: 1 } }, false, 2);
  assert.deepEqual(Object.keys(input.description).sort(), ['category', 'confidence', 'distinctive_features', 'identity_confidence', 'logos_markings', 'subcategory', 'visible_text']);
  assert.equal(JSON.stringify(input).includes('payout'), false);
  assert.equal(JSON.stringify(input).includes('merchant'), false);
  assert.equal(JSON.stringify(input).includes('result_class'), false);
});


test('Vercel Jev binding uses only the evaluation-model endpoint and expected headers', async () => {
  let seen;
  const binding = new VercelJevBinding('test-key', async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({
      answers: {
        commerce_action: { type: 'choice', choice: 'SEARCH_NORMAL' },
        verification_action: { type: 'choice', choice: 'FULL' },
        multiframe_action: { type: 'choice', choice: 'NO' },
      },
      usage: { inputTokens: 12, outputTokens: 0 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  const result = await routeWithJev(routerInput(evidence, false, 2), binding);
  assert.equal(result.telemetry.failed, false);
  assert.equal(result.telemetry.model, 'typesafe-ai/jev');
  assert.equal(seen.url, 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Authorization, 'Bearer test-key');
  assert.equal(seen.init.headers['ai-model-id'], 'typesafe-ai/jev');
  assert.equal(seen.init.headers['ai-evaluation-model-specification-version'], '4');
});


test('Jev binding prefers Vercel when both providers are configured', () => {
  const cloudflare = ai({
    answers: {
      commerce_action: { type: 'choice', choice: 'SEARCH_NORMAL' },
      verification_action: { type: 'choice', choice: 'LIGHT' },
      multiframe_action: { type: 'choice', choice: 'NO' },
    },
  });
  const binding = resolveJevBinding({ AI: cloudflare, AI_GATEWAY_API_KEY: 'vercel-key' });
  assert.ok(binding);
  assert.equal(binding.modelId, 'typesafe-ai/jev');
  assert.equal(typeof binding.run, 'function');
});

test('Jev binding falls back to native Cloudflare Workers AI when Vercel is unavailable', () => {
  const cloudflare = ai({
    answers: {
      commerce_action: { type: 'choice', choice: 'SEARCH_NORMAL' },
      verification_action: { type: 'choice', choice: 'LIGHT' },
      multiframe_action: { type: 'choice', choice: 'NO' },
    },
  });
  const binding = resolveJevBinding({ AI: cloudflare });
  assert.equal(binding, cloudflare);
});

test('Jev binding is disabled when no provider is configured', () => {
  assert.equal(resolveJevBinding({}), undefined);
});
