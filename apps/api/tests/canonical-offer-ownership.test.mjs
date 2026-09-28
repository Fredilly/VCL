import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ledgerMod = loadModule(resolve(here, '../src/verified-product-ledger.ts'));
const canonicalMod = loadModule(resolve(here, '../src/canonical-product-memory.ts'));

function storage() {
  const map = new Map();
  return {
    map,
    api: {
      async get(key) { return map.get(key); },
      async put(key, value) { map.set(key, structuredClone(value)); },
      async delete(key) { return map.delete(key); },
      async list({ prefix = '', limit = 1000 } = {}) {
        return new Map([...map.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, limit));
      },
    },
  };
}

function identity(canonicalKey, itemId, destination) {
  return {
    canonical_key: canonicalKey,
    title: 'Building Is My Love Language Shirt',
    brand: null,
    model: null,
    object_type: 't-shirt',
    visible_text: ['BUILDING IS MY LOVE LANGUAGE'],
    color: 'black',
    normalized_fingerprint: canonicalKey,
    relationship: 'EXACT',
    provenance: 'admin_verified',
    verified_at: new Date().toISOString(),
    merchant_refs: [{
      source: 'ebay',
      item_id: itemId,
      destination,
      image_reference: 'https://i.ebayimg.com/item.jpg',
    }],
  };
}

async function upsert(ledger, value) {
  const response = await ledger.fetch(new Request('https://ledger/canonical/upsert', {
    method: 'POST',
    body: JSON.stringify(value),
  }));
  assert.equal(response.status, 200);
  return await response.json();
}

test('same merchant offer always reuses one canonical identity', async () => {
  const ledger = new ledgerMod.VerifiedProductLedger({ storage: storage().api });
  const offer = 'v1|307197731843|607037825827';
  const destination = 'https://www.ebay.com/itm/307197731843?var=607037825827';

  const first = await upsert(ledger, identity('product:v1:first', offer, destination));
  const second = await upsert(ledger, identity('product:v1:duplicate', offer, destination));

  assert.equal(second.identity.canonical_key, first.identity.canonical_key);
  assert.equal(second.reused_existing_canonical, true);
});

test('concurrent writes cannot create two owners for the same offer', async () => {
  const ledger = new ledgerMod.VerifiedProductLedger({ storage: storage().api });
  const offer = 'v1|307197731843|607037825827';
  const destination = 'https://www.ebay.com/itm/307197731843?var=607037825827';

  const [a, b] = await Promise.all([
    upsert(ledger, identity('product:v1:a', offer, destination)),
    upsert(ledger, identity('product:v1:b', offer, destination)),
  ]);

  assert.equal(a.identity.canonical_key, b.identity.canonical_key);

  const lookup = await ledger.fetch(new Request('https://ledger/canonical/by-offer', {
    method: 'POST',
    body: JSON.stringify({ offer_key: canonicalMod.canonicalMerchantOfferKey({ source: 'ebay', item_id: offer, destination }) }),
  }));
  const result = await lookup.json();
  assert.equal(result.canonical_key, a.identity.canonical_key);
});

test('sibling merchant variations remain distinct offers', async () => {
  const ledger = new ledgerMod.VerifiedProductLedger({ storage: storage().api });

  const a = await upsert(ledger, identity(
    'product:v1:a',
    'v1|307197731843|607037825827',
    'https://www.ebay.com/itm/307197731843?var=607037825827',
  ));
  const b = await upsert(ledger, identity(
    'product:v1:b',
    'v1|307197731843|607037825830',
    'https://www.ebay.com/itm/307197731843?var=607037825830',
  ));

  assert.notEqual(a.identity.canonical_key, b.identity.canonical_key);
});


test('different offers consolidate only after explicit equivalent-product reconciliation', async () => {
  const ledger = new ledgerMod.VerifiedProductLedger({ storage: storage().api });
  const a = await upsert(ledger, identity(
    'product:v1:seller-a',
    'v1|111|aaa',
    'https://www.ebay.com/itm/111?var=aaa',
  ));
  const b = await upsert(ledger, identity(
    'product:v1:seller-b',
    'v1|222|bbb',
    'https://www.ebay.com/itm/222?var=bbb',
  ));
  assert.notEqual(a.identity.canonical_key, b.identity.canonical_key, 'different offers are not merged merely on write');

  const response = await ledger.fetch(new Request('https://ledger/canonical/consolidate', {
    method: 'POST',
    body: JSON.stringify({ canonical_keys: [a.identity.canonical_key, b.identity.canonical_key] }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.consolidated, true);
  assert.equal(body.identity.merchant_refs.length, 2);

  const redirected = await ledger.fetch(new Request('https://ledger/canonical/get', {
    method: 'POST',
    body: JSON.stringify({ canonical_key: b.identity.canonical_key }),
  }));
  const redirectedBody = await redirected.json();
  assert.equal(redirectedBody.identity.canonical_key, body.identity.canonical_key);
});

test('canonical consolidation fails closed when distinctive identity differs', async () => {
  const ledger = new ledgerMod.VerifiedProductLedger({ storage: storage().api });
  const a = await upsert(ledger, identity(
    'product:v1:a',
    'v1|111|aaa',
    'https://www.ebay.com/itm/111?var=aaa',
  ));
  const different = {
    ...identity('product:v1:b', 'v1|222|bbb', 'https://www.ebay.com/itm/222?var=bbb'),
    visible_text: ['BUILDING SOMETHING ELSE ENTIRELY'],
  };
  const b = await upsert(ledger, different);

  const response = await ledger.fetch(new Request('https://ledger/canonical/consolidate', {
    method: 'POST',
    body: JSON.stringify({ canonical_keys: [a.identity.canonical_key, b.identity.canonical_key] }),
  }));
  assert.equal(response.status, 409);
});


test('consolidation removes loser canonical residue while old offers resolve to survivor', async () => {
  const s = storage();
  const ledger = new ledgerMod.VerifiedProductLedger({ storage: s.api });
  const a = await upsert(ledger, identity(
    'product:v1:survivor-a',
    'v1|111|aaa',
    'https://www.ebay.com/itm/111?var=aaa',
  ));
  const b = await upsert(ledger, identity(
    'product:v1:loser-b',
    'v1|222|bbb',
    'https://www.ebay.com/itm/222?var=bbb',
  ));

  const response = await ledger.fetch(new Request('https://ledger/canonical/consolidate', {
    method: 'POST',
    body: JSON.stringify({ canonical_keys: [a.identity.canonical_key, b.identity.canonical_key] }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();

  const listResponse = await ledger.fetch(new Request('https://ledger/canonical/list', {
    method: 'POST',
    body: '{}',
  }));
  const listed = await listResponse.json();
  assert.deepEqual(listed.identities.map((row) => row.canonical_key), [body.identity.canonical_key]);

  const loserStorageKey = `canonical:${b.identity.canonical_key}`;
  assert.equal(s.map.has(loserStorageKey), false, 'loser canonical row is removed after redirect is written');

  const offerKey = canonicalMod.canonicalMerchantOfferKey({
    source: 'ebay',
    item_id: 'v1|222|bbb',
    destination: 'https://www.ebay.com/itm/222?var=bbb',
  });
  const offerLookup = await ledger.fetch(new Request('https://ledger/canonical/by-offer', {
    method: 'POST',
    body: JSON.stringify({ offer_key: offerKey }),
  }));
  const offerBody = await offerLookup.json();
  assert.equal(offerBody.canonical_key, body.identity.canonical_key);
});

test('redirect chains resolve to one final canonical key', async () => {
  const s = storage();
  const ledger = new ledgerMod.VerifiedProductLedger({ storage: s.api });
  const final = identity('product:v1:final', 'v1|333|ccc', 'https://www.ebay.com/itm/333?var=ccc');
  await upsert(ledger, final);
  await s.api.put('canonical-redirect:product:v1:old-a', 'product:v1:old-b');
  await s.api.put('canonical-redirect:product:v1:old-b', 'product:v1:final');

  const response = await ledger.fetch(new Request('https://ledger/canonical/get', {
    method: 'POST',
    body: JSON.stringify({ canonical_key: 'product:v1:old-a' }),
  }));
  const body = await response.json();
  assert.equal(body.identity.canonical_key, 'product:v1:final');
});
