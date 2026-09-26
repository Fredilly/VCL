import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const context = { platform: 'youtube', content_ref: 'youtube:continuity-video', timestamp_ms: 60_000 };
const description = {
  category: 'apparel', subcategory: 't-shirt', brand_candidate: null, model_candidate: null,
  color: 'black', material: 'cotton', style_attributes: ['oversized'],
  visible_text: ['BUILDING IS MY LOVE LANGUAGE'], logos_markings: [],
  distinctive_features: ['tonal chest lettering'], hardware_details: [], shape_silhouette: [],
  search_terms: ['black shirt'], confidence: 0.9, identity_confidence: 0.1,
};
const product = {
  id: 'listing-17', model: 'SKU-42', title: 'Verified tonal lettering tee', brand: 'Verified Brand',
  category: 't-shirt', destination: 'https://shop.example.com/item/17',
  image_reference: 'https://images.example.com/item17.jpg', provenance: 'ebay', provider: 'ebay',
  price: '30', currency: 'USD', result_class: 'SIMILAR', relationship: 'SIMILAR',
};
const sourceImage = 'data:image/png;base64,AQID';
const evidence = {
  subtype: { value: 't-shirt', confidence: 0.98, basis: 'image' },
  color: { value: 'black', confidence: 0.96, basis: 'image' },
  sleeve: { value: 'short', confidence: 0.95, basis: 'image' },
};

function harness() {
  const ledgerModule = loadModule(resolve(here, '../src/verified-product-ledger.ts'));
  const values = new Map();
  const ledger = new ledgerModule.VerifiedProductLedger({ storage: {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
  } });
  const control = { similarity: 0.96, unavailable: false, failedImages: new Set(), candidateEvidence: evidence };
  const calls = [];
  const server = loadModule(resolve(here, '../src/server.ts'), {
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, options) => {
      const address = String(url);
      calls.push(address);
      if (address.startsWith('https://images.example.com/')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: control.failedImages.has(address) ? 404 : 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      if (address.startsWith('https://generativelanguage.googleapis.com/')) {
        if (control.unavailable) return new Response(null, { status: 503 });
        const parts = JSON.parse(options.body).contents[0].parts;
        const candidates = parts.flatMap((part) => {
          if (!part.text?.startsWith('{')) return [];
          const value = JSON.parse(part.text);
          return Number.isInteger(value.index) ? [{
            index: value.index, attributes: control.candidateEvidence,
            similarity: control.similarity, confidence: 0.96,
            matching_details: ['matching tonal chest lettering layout', 'matching sleeve construction'],
          }] : [];
        });
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ source: evidence, candidates }) }] } }] });
      }
      throw new Error(`Unexpected network request: ${address}`);
    },
  });
  const env = {
    BENCHMARK_MODE: 'true', GEMINI_API_KEY: 'test-key',
    VERIFIED_PRODUCT_LEDGER: { idFromName: (name) => name, get: () => ({ fetch: (url, init) => ledger.fetch(new Request(url, init)) }) },
    ADMIN_ACCESS_LEDGER: { idFromName: (name) => name, get: () => ({ fetch: async () => Response.json({ admin: true, admin_id: 'tester' }) }) },
  };
  async function promote(offer = product, key) {
    const response = await server.default.fetch(new Request('https://api.example.com/admin/verified-product', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-scoop-admin-session': 'test-session' },
      body: JSON.stringify({ ...context, description, product: offer, canonical_key_hint: key }),
    }), env);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.accepted, true);
    return result;
  }
  async function scoop(timestamp, overrides = {}, video = context.content_ref) {
    const response = await server.default.fetch(new Request('https://api.example.com/resolve-products', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: { ...description, ...overrides }, source_image: sourceImage,
        context: { ...context, content_ref: video, timestamp_ms: timestamp } }),
    }), env);
    return { status: response.status, body: await response.json() };
  }
  return { promote, scoop, control, calls, server, env, ledgerModule };
}

test('promoted SKU is confirmed from pixels earlier, at promotion, and later despite new identity guesses', async () => {
  const h = harness();
  const saved = await h.promote();
  assert.equal(saved.mapping.merchant_item_id, 'listing-17');
  for (const timestamp of [5_000, 60_000, 300_000]) {
    const { status, body } = await h.scoop(timestamp, {
      subcategory: 'sweatshirt', brand_candidate: 'Unfounded Guess', model_candidate: 'OTHER-SKU', color: 'gray',
    });
    assert.equal(status, 200);
    assert.equal(body.verified_mapping.reason, 'visual_confirmed');
    assert.equal(body.verified_mapping.canonical_key, saved.canonical_key);
    assert.equal(body.products[0].canonical_key, saved.canonical_key);
    assert.equal(body.products[0].model, 'SKU-42');
    assert.equal(body.products[0].result_class, 'EXACT');
  }
  assert.equal(h.calls.filter((url) => url.includes('generateContent')).length, 3);
});

test('unclear or unavailable confirmation keeps memory and does not discover a replacement SKU', async () => {
  const h = harness();
  const saved = await h.promote();
  h.control.similarity = 0.8;
  let result = await h.scoop(300_000);
  assert.equal(result.body.identity_confirmation, 'required');
  assert.equal(result.body.verified_mapping.reason, 'weak_evidence');
  assert.deepEqual(result.body.products, []);
  assert.equal(result.body.attempts, 0);
  h.control.unavailable = true;
  result = await h.scoop(1_000);
  assert.equal(result.body.identity_confirmation, 'required');
  assert.equal(result.body.verified_mapping.reason, 'visual_unavailable');
  const identity = await h.ledgerModule.durableCanonicalProductIdentity(h.env, saved.canonical_key);
  assert.equal(identity.model, 'SKU-42');
  h.control.unavailable = false;
  h.control.similarity = 0.96;
  result = await h.scoop(350_000);
  assert.equal(result.body.products[0].canonical_key, saved.canonical_key);
});

test('matching a guessed model or a nearby timestamp never bypasses pixel confirmation', async () => {
  const h = harness();
  await h.promote();
  h.control.candidateEvidence = { ...evidence, color: { value: 'white', confidence: 0.99, basis: 'image' } };
  const { body } = await h.scoop(60_000, { brand_candidate: product.brand, model_candidate: product.model });
  assert.notEqual(body.verified_mapping?.hit, true);
  assert.equal(h.calls.filter((url) => url.includes('generateContent')).length, 1);
});

test('another exact merchant image can confirm identity after the first thumbnail disappears', async () => {
  const h = harness();
  const first = await h.promote();
  await h.promote({ ...product, id: 'listing-18', destination: 'https://shop.example.com/item/18',
    image_reference: 'https://images.example.com/item18.jpg' }, first.canonical_key);
  h.control.failedImages.add(product.image_reference);
  const { body } = await h.scoop(300_000);
  assert.equal(body.verified_mapping.hit, true);
  assert.equal(body.products[0].canonical_key, first.canonical_key);
  assert.ok(h.calls.includes('https://images.example.com/item18.jpg'));
});

test('saved products from another video are not reused', async () => {
  const h = harness();
  await h.promote();
  const { body } = await h.scoop(60_000, {}, 'youtube:another-video');
  assert.notEqual(body.verified_mapping?.hit, true);
  assert.equal(h.calls.length, 0);
});

test('commerce refresh uses listing ID and saved SKU independently even when lookup fails', async () => {
  const h = harness();
  const saved = await h.promote();
  const calls = [];
  const provider = {
    async getItemById(id) { calls.push(['get', id]); return null; },
    async search(query) { calls.push(['search', query.model]); return []; },
  };
  // Legacy mappings already have the merchant ID in canonical merchant_refs.
  const { merchant_item_id: _removed, ...legacyMapping } = saved.mapping;
  const refreshed = await h.server.refreshVerifiedOffers([{ name: 'ebay', provider, tier: 'primary' }], legacyMapping, {
    env: h.env, description, sourceImage: { mimeType: 'image/png', data: 'AQID' },
  });
  assert.deepEqual(calls, [['get', 'listing-17'], ['search', 'SKU-42']]);
  assert.equal(refreshed.products[0].model, 'SKU-42');
  assert.equal(refreshed.products[0].canonical_key, saved.canonical_key);
});

test('a saved-memory read failure does not become a fresh discovery request', async () => {
  const h = harness();
  await h.promote();
  h.env.VERIFIED_PRODUCT_LEDGER.get = () => ({ fetch: async () => new Response(null, { status: 503 }) });
  const { status, body } = await h.scoop(300_000);
  assert.equal(status, 503);
  assert.equal(body.failure_state, 'TEMPORARILY_UNAVAILABLE');
  assert.match(body.error, /Saved product identities/);
  assert.equal(h.calls.length, 0);
});

test('two different visually confirmed saved products remain ambiguous', async () => {
  const h = harness();
  await h.promote();
  await h.promote({ ...product, id: 'listing-other', model: 'SKU-OTHER',
    destination: 'https://shop.example.com/item/other', image_reference: 'https://images.example.com/other.jpg' });
  const { body } = await h.scoop(300_000);
  assert.equal(body.verified_mapping.reason, 'ambiguous');
  assert.equal(body.identity_confirmation, 'required');
  assert.deepEqual(body.products, []);
});

test('a demoted offer image cannot be used to confirm canonical identity', async () => {
  const h = harness();
  const saved = await h.promote();
  const identity = await h.ledgerModule.durableCanonicalProductIdentity(h.env, saved.canonical_key);
  await h.ledgerModule.persistCanonicalProductIdentity(h.env, {
    ...identity,
    merchant_refs: [
      { source: 'ebay', item_id: 'different', destination: 'https://shop.example.com/different',
        image_reference: 'https://images.example.com/demoted.jpg', relationship: 'SIMILAR' },
    ],
  });
  const { body } = await h.scoop(300_000);
  assert.equal(body.verified_mapping.hit, true);
  assert.equal(h.calls.includes('https://images.example.com/demoted.jpg'), false);
});
