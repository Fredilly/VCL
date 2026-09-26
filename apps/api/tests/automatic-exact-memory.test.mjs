import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const memory = loadModule(resolve(here, '../src/automatic-exact-memory.ts'));
const ledger = loadModule(resolve(here, '../src/verified-product-ledger.ts'));

const description = {
  category: 'apparel',
  subcategory: 't-shirt',
  brand_candidate: 'Nike',
  model_candidate: 'DX1234-100',
  color: 'black',
  material: 'cotton',
  style_attributes: ['short sleeve'],
  visible_text: ['NIKE DX1234-100'],
  logos_markings: ['Nike swoosh'],
  distinctive_features: ['large white chest wordmark'],
  hardware_details: [],
  shape_silhouette: ['crew neck'],
  search_terms: ['Nike DX1234-100 black shirt'],
  confidence: 0.96,
  identity_confidence: 0.95,
};

const exact = {
  id: 'merchant-offer-1',
  title: 'Nike DX1234-100 Black Tee',
  brand: 'Nike',
  model: 'DX1234-100',
  category: 't-shirt',
  image_reference: 'https://example.com/nike.jpg',
  provenance: 'brave',
  provider: 'brave',
  destination: 'https://shop.example.com/nike-dx1234',
  price: '49.99',
  currency: 'USD',
  result_class: 'LIKELY',
  relationship: 'EXACT',
};

const context = {
  platform: 'youtube',
  content_ref: 'youtube:video-1',
  timestamp_ms: 42000,
};

test('automatic EXACT becomes canonical video memory with dynamic offer data', () => {
  const result = memory.automaticExactMemory(exact, description, context);
  assert.ok(result);
  assert.equal(result.mapping.provenance, 'automatic_verified');
  assert.equal(result.mapping.scope, 'time_window');
  assert.equal(result.mapping.timestamp_start_ms, 37000);
  assert.equal(result.mapping.timestamp_end_ms, 47000);
  assert.equal(result.identity.relationship, 'EXACT');
  assert.equal(result.identity.model, 'DX1234-100');
  assert.equal(result.identity.merchant_refs[0].price, '49.99');
  assert.equal(result.identity.merchant_refs[0].currency, 'USD');
  assert.equal(result.mapping.canonical_key, result.identity.canonical_key);
});

test('SIMILAR and RELATED never create identity memory', () => {
  assert.equal(memory.automaticExactMemory({ ...exact, relationship: 'SIMILAR' }, description, context), null);
  assert.equal(memory.automaticExactMemory({ ...exact, relationship: 'RELATED' }, description, context), null);
});

test('multiple exact offers for one verified identity persist all offer images', () => {
  const second = {
    ...exact,
    id: 'merchant-offer-2',
    provider: 'etsy',
    provenance: 'etsy',
    destination: 'https://etsy.example.com/nike-dx1234',
    image_reference: 'https://etsy.example.com/nike.jpg',
    identity_key: 'nike:dx1234:t-shirt:black',
  };
  const first = { ...exact, identity_key: second.identity_key };
  const result = memory.automaticExactMemory([first, second], description, context);
  assert.ok(result);
  assert.equal(result.mapping.canonical_key, result.identity.canonical_key);
  assert.deepEqual(result.identity.merchant_refs.map((ref) => ref.image_reference), [
    first.image_reference,
    second.image_reference,
  ]);
});

test('different exact identities remain ambiguous and are not persisted', () => {
  const second = { ...exact, id: 'other-item', identity_key: 'nike:other-model:t-shirt:black' };
  const first = { ...exact, identity_key: 'nike:dx1234:t-shirt:black' };
  assert.equal(memory.automaticExactMemory([first, second], description, context), null);
});

test('EXACT without stable video identity is not persisted', () => {
  assert.equal(memory.automaticExactMemory(exact, description, { timestamp_ms: 42000 }), null);
  assert.equal(memory.automaticExactMemory(exact, description, { platform: 'youtube', content_ref: 'youtube:video-1' }), null);
});

test('ledger accepts automatic verified mapping and keeps it addressable by video', async () => {
  const result = memory.automaticExactMemory(exact, description, context);
  assert.ok(result);
  const values = new Map();
  const object = new ledger.VerifiedProductLedger({
    storage: {
      async get(key) { return values.get(key); },
      async put(key, value) { values.set(key, value); },
    },
  });

  const save = await object.fetch(new Request('https://verified-product-ledger/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result.mapping),
  }));
  assert.equal(save.status, 200);

  const lookup = await object.fetch(new Request('https://verified-product-ledger/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'youtube', content_ref: 'youtube:video-1' }),
  }));
  const body = await lookup.json();
  assert.equal(body.mappings.length, 1);
  assert.equal(body.mappings[0].canonical_key, result.identity.canonical_key);
  assert.equal(body.mappings[0].provenance, 'automatic_verified');
});


test('re-observing the same canonical product at a later timestamp replaces its video mapping', async () => {
  const first = memory.automaticExactMemory(exact, description, context);
  const later = memory.automaticExactMemory(exact, description, { ...context, timestamp_ms: 300000 });
  assert.ok(first);
  assert.ok(later);
  assert.equal(first.mapping.canonical_key, later.mapping.canonical_key);

  const values = new Map();
  const object = new ledger.VerifiedProductLedger({
    storage: {
      async get(key) { return values.get(key); },
      async put(key, value) { values.set(key, value); },
    },
  });

  for (const mapping of [first.mapping, later.mapping]) {
    const save = await object.fetch(new Request('https://verified-product-ledger/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mapping),
    }));
    assert.equal(save.status, 200);
  }

  const lookup = await object.fetch(new Request('https://verified-product-ledger/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: context.platform, content_ref: context.content_ref }),
  }));
  const body = await lookup.json();
  assert.equal(body.mappings.length, 1);
  assert.equal(body.mappings[0].canonical_key, first.mapping.canonical_key);
  assert.equal(body.mappings[0].timestamp_start_ms, 295000);
  assert.equal(body.mappings[0].timestamp_end_ms, 305000);
});
