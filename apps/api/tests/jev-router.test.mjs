import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const { routeWithJev, routerInput } = loadModule(new URL('../src/jev-router.ts', import.meta.url).pathname);
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
});

test('malformed response fails open and cannot assign identity classes', async () => {
  const result = await routeWithJev(routerInput(evidence, false, 1), ai({ result_class: 'EXACT', commerce_action: 'SKIP' }));
  assert.equal(result.decision.commerce_action, 'SEARCH_NORMAL');
  assert.equal(result.decision.verification_action, 'FULL');
  assert.equal(result.decision.multiframe_action, 'NO');
  assert.equal(result.telemetry.failed, true);
});

test('Workers AI error fails open', async () => {
  const result = await routeWithJev(routerInput(evidence, false, 1), ai(null, new Error('AI unavailable')));
  assert.equal(result.telemetry.failed, true);
  assert.equal(result.decision.verification_action, 'FULL');
});

test('timeout fails open', async () => {
  const result = await routeWithJev(routerInput(evidence, false, 1), { async run() { return new Promise(() => {}); } }, 5);
  assert.equal(result.telemetry.failed, true);
  assert.equal(result.decision.commerce_action, 'SEARCH_NORMAL');
});

test('router input excludes identity classes and commercial/provider payout data', () => {
  const input = routerInput({ ...evidence, brand_candidate: 'CASIO', model_candidate: 'F-91W', search_terms: ['watch'], provider_usage: { provider: 'x', model: 'y', requests: 1 } }, false, 2);
  assert.deepEqual(Object.keys(input.description).sort(), ['category', 'confidence', 'distinctive_features', 'identity_confidence', 'logos_markings', 'subcategory', 'visible_text']);
  assert.equal(JSON.stringify(input).includes('payout'), false);
  assert.equal(JSON.stringify(input).includes('merchant'), false);
  assert.equal(JSON.stringify(input).includes('result_class'), false);
});
