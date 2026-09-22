import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const { routeWithJevFabric } = loadModule(new URL('../src/jev-fabric.ts', import.meta.url).pathname);
const { routerInput } = loadModule(new URL('../src/jev-router.ts', import.meta.url).pathname);

const evidence = {
  category: 'watch',
  subcategory: 'digital watch',
  confidence: 0.96,
  identity_confidence: 0.94,
  visible_text: ['CASIO'],
  logos_markings: ['CASIO'],
  distinctive_features: ['black resin band'],
};

function answer(choice, confidence) {
  return { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } };
}

function ai(answers) {
  return { async run() { return { answers, usage: { input_tokens: 100, output_tokens: 20 } }; } };
}

test('fabric batches atomic judgments into one call and chooses LIGHT for strong evidence', async () => {
  let calls = 0;
  const binding = { async run() {
    calls++;
    return { answers: {
      commerce_needed: answer('YES', 0.99),
      broad_search_needed: answer('NO', 0.9),
      verification_needed: answer('NO', 0.92),
      multiframe_needed: answer('NO', 0.9),
    }, usage: { input_tokens: 100, output_tokens: 20 } };
  }};
  const result = await routeWithJevFabric(routerInput(evidence, true, 2), binding);
  assert.equal(calls, 1);
  assert.equal(result.decision.commerce_action, 'SEARCH_NORMAL');
  assert.equal(result.decision.verification_action, 'LIGHT');
  assert.equal(result.decision.multiframe_action, 'NO');
  assert.equal(result.telemetry.mode, 'fabric');
  assert.equal(result.telemetry.calls, 1);
});

test('fabric skips commerce only on a high-confidence NO', async () => {
  const result = await routeWithJevFabric(routerInput(evidence, false, 2), ai({
    commerce_needed: answer('NO', 0.95),
    broad_search_needed: answer('NO', 0.9),
    verification_needed: answer('YES', 0.9),
    multiframe_needed: answer('NO', 0.9),
  }));
  assert.equal(result.decision.commerce_action, 'SKIP');
});

test('fabric does not skip commerce on uncertain NO', async () => {
  const result = await routeWithJevFabric(routerInput(evidence, false, 2), ai({
    commerce_needed: answer('NO', 0.7),
    broad_search_needed: answer('NO', 0.9),
    verification_needed: answer('YES', 0.9),
    multiframe_needed: answer('NO', 0.9),
  }));
  assert.equal(result.decision.commerce_action, 'SEARCH_NORMAL');
});

test('fabric refuses LIGHT when deterministic evidence floor is weak', async () => {
  const weak = { ...evidence, confidence: 0.7, identity_confidence: 0.6, visible_text: [], logos_markings: [], distinctive_features: [] };
  const result = await routeWithJevFabric(routerInput(weak, false, 2), ai({
    commerce_needed: answer('YES', 0.99),
    broad_search_needed: answer('NO', 0.9),
    verification_needed: answer('NO', 0.99),
    multiframe_needed: answer('NO', 0.9),
  }));
  assert.equal(result.decision.verification_action, 'FULL');
});

test('fabric fails open to safe normal/full/no behavior', async () => {
  const result = await routeWithJevFabric(routerInput(evidence, true, 2), { async run() { return { nope: true }; } });
  assert.equal(result.telemetry.failed, true);
  assert.deepEqual(result.decision, { commerce_action: 'SEARCH_NORMAL', verification_action: 'FULL', multiframe_action: 'NO' });
});
