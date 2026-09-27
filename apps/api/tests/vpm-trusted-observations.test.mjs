import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ledgerMod = loadModule(resolve(here, '../src/verified-product-ledger.ts'));
const reuseMod = loadModule(resolve(here, '../src/same-video-verified-reuse.ts'));

function storage() {
  const map = new Map();
  return {
    map,
    api: {
      async get(key) { return map.get(key); },
      async put(key, value) { map.set(key, structuredClone(value)); },
    },
  };
}

const mapping = {
  platform: 'youtube',
  content_ref: 'youtube:video-1',
  scope: 'time_window',
  timestamp_start_ms: 1000,
  timestamp_end_ms: 9000,
  object_type: 't-shirt',
  brand: '',
  product_id: 'merchant-item-1',
  title: 'Building is my Love Language Black Tee',
  destination: 'https://example.com/item',
  canonical_key: 'product:v1:shirt',
  track_id: 'product:v1:shirt',
  provenance: 'admin_verified',
};

const observation = (timestamp_ms, text = 'BUILDING IS MY LOVE LANGUAGE') => ({
  observed_at: new Date(1_790_000_000_000 + timestamp_ms).toISOString(),
  timestamp_ms,
  reason: 'distinctive_text_exact',
  confidence: 0.96,
  visible_text: [text],
  logos_markings: [text],
  distinctive_features: ['tonal chest lettering'],
  shape_silhouette: ['oversized short sleeve tee'],
  style_attributes: ['oversized'],
  color: 'black',
  material: 'cotton',
});

test('trusted VPM observations accumulate on the existing video product memory', async () => {
  const s = storage();
  const ledger = new ledgerMod.VerifiedProductLedger({ storage: s.api });
  await ledger.fetch(new Request('https://ledger/verify', { method: 'POST', body: JSON.stringify(mapping) }));

  for (const timestamp of [12000, 45000]) {
    const response = await ledger.fetch(new Request('https://ledger/observe', {
      method: 'POST',
      body: JSON.stringify({ platform: mapping.platform, content_ref: mapping.content_ref, canonical_key: mapping.canonical_key, observation: observation(timestamp) }),
    }));
    assert.equal(response.status, 200);
  }

  const lookup = await ledger.fetch(new Request('https://ledger/lookup', {
    method: 'POST',
    body: JSON.stringify({ platform: mapping.platform, content_ref: mapping.content_ref }),
  }));
  const result = await lookup.json();
  assert.equal(result.mappings.length, 1);
  assert.equal(result.mappings[0].trusted_observations.length, 2);
});

test('repeated identical observation in the same time bucket is deduplicated', async () => {
  const s = storage();
  const ledger = new ledgerMod.VerifiedProductLedger({ storage: s.api });
  await ledger.fetch(new Request('https://ledger/verify', { method: 'POST', body: JSON.stringify(mapping) }));
  const body = { platform: mapping.platform, content_ref: mapping.content_ref, canonical_key: mapping.canonical_key, observation: observation(12000) };
  await ledger.fetch(new Request('https://ledger/observe', { method: 'POST', body: JSON.stringify(body) }));
  await ledger.fetch(new Request('https://ledger/observe', { method: 'POST', body: JSON.stringify(body) }));
  const result = await (await ledger.fetch(new Request('https://ledger/lookup', { method: 'POST', body: JSON.stringify({ platform: mapping.platform, content_ref: mapping.content_ref }) }))).json();
  assert.equal(result.mappings[0].trusted_observations.length, 1);
});

test('trusted observations enrich only the video-specific VPM identity', () => {
  const identity = {
    canonical_key: mapping.canonical_key,
    title: mapping.title,
    brand: null,
    model: null,
    object_type: 't-shirt',
    visible_text: ['BUILDING IS MY LOVE LANGUAGE'],
    color: 'black',
    normalized_fingerprint: 'x',
    relationship: 'EXACT',
    provenance: 'admin_verified',
    verified_at: new Date().toISOString(),
    merchant_refs: [],
  };
  const enriched = reuseMod.identityWithTrustedVpmObservations(identity, {
    ...mapping,
    trusted_observations: [observation(12000, 'BUILDING MY LOVE LANGUAGE'), observation(45000, 'LOVE LANGUAGE')],
  });
  assert.ok(enriched.visible_text.includes('BUILDING MY LOVE LANGUAGE'));
  assert.ok(enriched.visible_text.includes('LOVE LANGUAGE'));
  assert.equal(identity.visible_text.length, 1, 'global canonical identity is not mutated');
});

test('unknown or ambiguous outcomes cannot write VPM observations through the ledger', async () => {
  const s = storage();
  const ledger = new ledgerMod.VerifiedProductLedger({ storage: s.api });
  await ledger.fetch(new Request('https://ledger/verify', { method: 'POST', body: JSON.stringify(mapping) }));
  const bad = await ledger.fetch(new Request('https://ledger/observe', {
    method: 'POST',
    body: JSON.stringify({
      platform: mapping.platform,
      content_ref: mapping.content_ref,
      canonical_key: mapping.canonical_key,
      observation: { ...observation(12000), reason: 'ambiguous' },
    }),
  }));
  assert.equal(bad.status, 400);
});
