import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ledgerMod = loadModule(resolve(here, '../src/verified-product-ledger.ts'));

function storage() {
  const map = new Map();
  return {
    api: {
      async get(key) { return map.get(key); },
      async put(key, value) { map.set(key, structuredClone(value)); },
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
    body: JSON.stringify({ offer_key: `ebay:${offer.toLowerCase()}` }),
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
