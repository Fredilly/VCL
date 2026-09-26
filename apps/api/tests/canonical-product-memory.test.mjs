import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const memory = loadModule(resolve(here, '../src/canonical-product-memory.ts'));
const ledger = loadModule(resolve(here, '../src/verified-product-ledger.ts'));

const mapping = {
  platform: 'youtube',
  content_ref: 'youtube:video-1',
  scope: 'time_window',
  timestamp_start_ms: 1000,
  timestamp_end_ms: 9000,
  object_type: 't-shirt',
  brand: '',
  product_id: 'merchant-item-1',
  title: 'Building is my Love Language Black Oversized Tee',
  destination: 'https://www.ebay.com/itm/merchant-item-1',
  image_reference: 'https://i.ebayimg.com/item.jpg',
  provider: 'ebay',
  provenance: 'admin_verified',
};

test('canonical identity separates product fingerprint from merchant item id', () => {
  const identity = memory.canonicalProductIdentity({
    mapping,
    model: null,
    merchantItemId: 'merchant-item-1',
    visibleText: ['BUILDING IS MY LOVE LANGUAGE'],
    verifiedAt: '2026-09-25T00:00:00.000Z',
  });
  assert.match(identity.canonical_key, /^product:v1:/);
  assert.equal(identity.model, null);
  assert.equal(identity.merchant_refs[0].item_id, 'merchant-item-1');
  assert.equal(identity.merchant_refs[0].source, 'ebay');
  assert.match(identity.normalized_fingerprint, /building is my love language/);
});

test('canonical upsert is idempotent and merges merchant provenance', async () => {
  const values = new Map();
  const store = {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
  };
  const object = new ledger.VerifiedProductLedger({ storage: store });
  const first = memory.canonicalProductIdentity({
    mapping,
    merchantItemId: 'merchant-item-1',
    visibleText: ['BUILDING IS MY LOVE LANGUAGE'],
    verifiedAt: '2026-09-25T00:00:00.000Z',
  });

  const upsert = (identity) => object.fetch(new Request('https://verified-product-ledger/canonical/upsert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(identity),
  }));

  assert.equal((await upsert(first)).status, 200);
  assert.equal((await upsert(first)).status, 200);

  const second = {
    ...first,
    verified_at: '2026-09-25T01:00:00.000Z',
    merchant_refs: [{
      source: 'merchant-two',
      item_id: 'other-offer',
      destination: 'https://example.com/other-offer',
      image_reference: null,
    }],
  };
  const response = await upsert(second);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.identity.merchant_refs.length, 2);
});

test('conflicting identity evidence fails closed', async () => {
  const values = new Map();
  const object = new ledger.VerifiedProductLedger({
    storage: {
      async get(key) { return values.get(key); },
      async put(key, value) { values.set(key, value); },
    },
  });
  const original = memory.canonicalProductIdentity({
    mapping: { ...mapping, brand: 'Brand A' },
    model: 'MODEL-1',
    merchantItemId: 'one',
    verifiedAt: '2026-09-25T00:00:00.000Z',
  });
  const conflicting = { ...original, brand: 'Brand B' };

  const send = (identity) => object.fetch(new Request('https://verified-product-ledger/canonical/upsert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(identity),
  }));

  assert.equal((await send(original)).status, 200);
  assert.equal((await send(conflicting)).status, 409);
});


test('legacy admin verified mapping is backfilled with canonical link', async () => {
  const values = new Map();
  const object = new ledger.VerifiedProductLedger({
    storage: {
      async get(key) { return values.get(key); },
      async put(key, value) { values.set(key, value); },
    },
  });

  const namespace = {
    idFromName(name) { return name; },
    get() {
      return {
        fetch(input, init) {
          return object.fetch(new Request(input, init));
        },
      };
    },
  };
  const env = { VERIFIED_PRODUCT_LEDGER: namespace };

  await ledger.persistAdminVerifiedMapping(env, mapping);
  const legacy = await ledger.durableVerifiedMappings(env, mapping.platform, mapping.content_ref);
  assert.equal(legacy[0].canonical_key, undefined);

  const upgraded = await ledger.backfillLegacyAdminCanonicalMappings(env, legacy);
  assert.match(upgraded[0].canonical_key, /^product:v1:/);

  const stored = await ledger.durableVerifiedMappings(env, mapping.platform, mapping.content_ref);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].canonical_key, upgraded[0].canonical_key);

  const canonical = await ledger.durableCanonicalProductIdentity(env, upgraded[0].canonical_key);
  assert.equal(canonical?.title, mapping.title);
  assert.equal(canonical?.merchant_refs[0].item_id, mapping.product_id);
});

test('legacy non-admin mapping is not upgraded implicitly', async () => {
  const fixture = { ...mapping, provenance: 'test_fixture' };
  const result = await ledger.backfillLegacyAdminCanonicalMappings({}, [fixture]);
  assert.equal(result[0].canonical_key, undefined);
});


test('canonical merge enriches an existing merchant ref with a newly recovered image', () => {
  const first = memory.canonicalProductIdentity({
    mapping: { ...mapping, image_reference: null },
    merchantItemId: 'merchant-item-1',
    visibleText: [],
    verifiedAt: '2026-09-25T00:00:00.000Z',
  });
  const second = memory.canonicalProductIdentity({
    mapping: { ...mapping, image_reference: 'https://i.ebayimg.com/recovered.jpg' },
    merchantItemId: 'merchant-item-1',
    visibleText: [],
    verifiedAt: '2026-09-25T01:00:00.000Z',
  });

  const merged = memory.mergeCanonicalProductIdentity(first, second);
  assert.equal(merged.merchant_refs.length, 1);
  assert.equal(merged.merchant_refs[0].image_reference, 'https://i.ebayimg.com/recovered.jpg');
});
