import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const ledgerMod = loadModule(new URL('../src/verified-product-ledger.ts', import.meta.url).pathname);

function storage() {
  const map = new Map();
  const listPrefixes = [];
  return {
    listPrefixes,
    api: {
      async get(key) { return map.get(key); },
      async put(key, value) { map.set(key, structuredClone(value)); },
      async list({ prefix = '', limit = 1000 } = {}) {
        listPrefixes.push(prefix);
        return new Map([...map.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, limit));
      },
    },
  };
}

function identity(key, overrides = {}) {
  return {
    canonical_key: key,
    title: 'Building Is My Love Language Black Tee',
    brand: 'Builder Co',
    model: 'BMLL-01',
    object_type: 't-shirt',
    visible_text: ['BUILDING IS MY LOVE LANGUAGE'],
    color: 'black',
    normalized_fingerprint: key,
    relationship: 'EXACT',
    provenance: 'admin_verified',
    verified_at: new Date().toISOString(),
    merchant_refs: [{
      source: 'ebay',
      item_id: key,
      destination: `https://www.ebay.com/itm/${encodeURIComponent(key)}`,
      image_reference: 'https://i.ebayimg.com/item.jpg',
    }],
    ...overrides,
  };
}

async function upsert(ledger, value) {
  const response = await ledger.fetch(new Request('https://ledger/canonical/upsert', {
    method: 'POST',
    body: JSON.stringify(value),
  }));
  assert.equal(response.status, 200);
}

async function search(ledger, body) {
  const response = await ledger.fetch(new Request('https://ledger/canonical/search', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
  assert.equal(response.status, 200);
  return await response.json();
}

test('indexed text retrieval returns a bounded candidate set without canonical-list scan', async () => {
  const s = storage();
  const ledger = new ledgerMod.VerifiedProductLedger({ storage: s.api });
  await upsert(ledger, identity('product:target'));
  for (let i = 0; i < 40; i += 1) {
    await upsert(ledger, identity(`product:noise-${i}`, {
      title: `Generic shirt ${i}`,
      model: `GEN-${i}`,
      visible_text: ['GENERIC SHIRT'],
    }));
  }

  const result = await search(ledger, {
    paths: ['TEXT'],
    visible_text: ['BUILDING IS MY LOVE LANGUAGE'],
    logos_markings: [],
    limit: 8,
  });

  assert.equal(result.identities[0].canonical_key, 'product:target');
  assert.ok(result.identities.length <= 8);
  assert.ok(s.listPrefixes.every((prefix) => prefix.startsWith('canonical-idx:text:')));
});

test('model retrieval hits the exact evidence index and stays bounded', async () => {
  const s = storage();
  const ledger = new ledgerMod.VerifiedProductLedger({ storage: s.api });
  await upsert(ledger, identity('product:watch', {
    title: 'Casio F-91W',
    brand: 'Casio',
    model: 'F-91W',
    object_type: 'digital watch',
    visible_text: ['CASIO'],
    color: 'black',
  }));
  await upsert(ledger, identity('product:other', {
    title: 'Another Digital Watch',
    brand: 'Other',
    model: 'X1',
    object_type: 'digital watch',
    visible_text: ['OTHER'],
  }));

  const result = await search(ledger, {
    paths: ['MODEL'],
    brand: 'CASIO',
    model: 'F-91W',
    object_type: 'digital watch',
    limit: 4,
  });

  assert.deepEqual(result.identities.map((row) => row.canonical_key), ['product:watch']);
  assert.ok(s.listPrefixes.some((prefix) => prefix.startsWith('canonical-idx:model:casio:f_91w:')));
});

test('SKIP-equivalent empty retrieval paths do no index work', async () => {
  const s = storage();
  const ledger = new ledgerMod.VerifiedProductLedger({ storage: s.api });
  await upsert(ledger, identity('product:target'));
  s.listPrefixes.length = 0;

  const result = await search(ledger, { paths: [], limit: 8 });
  assert.deepEqual(result.identities, []);
  assert.equal(s.listPrefixes.length, 0);
});
