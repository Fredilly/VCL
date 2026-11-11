import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

// End to end through the HTTP resolver with a mocked verifier model that
// answers the way the real one does on a roster of lookalikes: sure of a
// match, only fairly sure (0.75) of each rejection. Under the previous
// coverage rule every one of these clicks ended as incomplete_comparison.

const learning = loadModule(new URL('../src/partner-learning.ts', import.meta.url).pathname);
const ledgerMod = loadModule(new URL('../src/verified-product-ledger.ts', import.meta.url).pathname);

function environment() {
  const values = new Map();
  const storage = {
    get: async key => values.get(key), put: async (key, value) => values.set(key, value),
    delete: async key => values.delete(key),
    list: async ({ prefix, limit } = {}) => new Map([...values].filter(([key]) => !prefix || key.startsWith(prefix)).slice(0, limit)),
    transaction: async operation => { const before = new Map(values); try { return await operation(storage); } catch (error) { values.clear(); for (const [key, value] of before) values.set(key, value); throw error; } },
  };
  const ledger = new ledgerMod.VerifiedProductLedger({ storage });
  return { VERIFIED_PRODUCT_LEDGER: { idFromName: x => x, get: () => ({ fetch: (url, options) => ledger.fetch(new Request(url, options)) }) } };
}
const catalog = { mimeType: 'image/png', data: btoa('catalog reference bytes') };
const crop = { mimeType: 'image/png', data: btoa('selected crop bytes') };
const deps = { metadata: async () => { throw new Error('explicit rows must not refetch pages'); }, image: async () => catalog };
const description = { category: 'accessories', subcategory: 'bag', brand_candidate: 'Louis Vuitton', model_candidate: null, color: 'brown', material: 'canvas', visible_text: [], logos_markings: [], distinctive_features: [], shape_silhouette: [], style_attributes: [], hardware_details: [], search_terms: [], confidence: .9, identity_confidence: 0 };
const evidence = { subtype: { value: 'bag', confidence: .98, basis: 'image' }, color: { value: 'brown', confidence: .98, basis: 'image' } };

// Eight variants across three families; the first one is a video-local identity.
const VARIANTS = ['Speedy Red 20', 'Speedy Red 40', 'Speedy Yellow', 'Neverfull Classic', 'Neverfull Floral', 'CarryAll MM', 'CarryAll Black', 'Trunkie'];
const offers = VARIANTS.map((name, index) => {
  const slug = name.toLowerCase().replace(/ /g, '-');
  const base = { destination: `https://catalog.shop/products/${slug}`, brand: 'Louis Vuitton', title: `Louis Vuitton ${name}`, object_type: 'bag', family: name.split(' ')[0], image_reference: `https://images.shop/${slug}.png` };
  return index === 0 ? { ...base, variant_id: 'VR-video-A-1-red-20', identity_scope: 'video_local' } : { ...base, sku: `SKU-${slug}` };
});

async function resolve({ stage, round = () => null, failBatchWith = null }) {
  const env = environment();
  const rows = await learning.preparePartnerRoster(env, 'https://api.scoop.shop', { platform: 'youtube', content_ref: 'video-A', offers }, deps);
  await learning.ingestPartnerRoster(env, rows);
  Object.assign(env, { GEMINI_API_KEY: 'test-only', BRAVE_SEARCH_API_KEY: 'test-only', BENCHMARK_MODE: 'true' });
  const calls = { stage: 0, round: 0, roundOrder: null };
  let server;
  server = loadModule(new URL('../src/server.ts', import.meta.url).pathname, { console: { error() {}, warn() {} },
    fetch: async (url, options) => {
      const host = new URL(String(url)).hostname;
      if (host === 'api.scoop.shop') return server.default.fetch(new Request(url, options), env);
      if (host === 'api.search.brave.com') return Response.json({ web: { results: [] } });
      if (host === 'generativelanguage.googleapis.com') {
        const request = JSON.parse(options.body);
        const isRound = request.systemInstruction.parts[0].text.includes('close alternatives');
        const listed = request.contents[0].parts.flatMap(part => {
          try { const value = JSON.parse(part.text); return typeof value.index === 'number' ? [value] : []; } catch { return []; }
        });
        if (isRound) { calls.round++; calls.roundOrder = listed.map(row => row.title.replace('Louis Vuitton ', '')); }
        else {
          calls.stage++;
          // The batch holding this product never returns usable output, recovery included.
          if (failBatchWith && listed.some(row => row.title.endsWith(failBatchWith))) return Response.json({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] });
        }
        const score = row => (isRound ? round(row.title.replace('Louis Vuitton ', '')) : null) ?? stage(row.title.replace('Louis Vuitton ', ''));
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ source: evidence,
          candidates: listed.map(row => { const [similarity, confidence] = score(row); return { index: row.index, attributes: evidence, similarity, confidence,
            matching_details: similarity >= .5 ? ['matching rolled handles and front padlock'] : [] }; }) }) }] } }] });
      }
      throw Error(`Unexpected fetch ${host}`);
    } });
  const response = await server.default.fetch(new Request('https://api.scoop.shop/resolve-products', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description, source_image: `data:${crop.mimeType};base64,${crop.data}`,
      context: { platform: 'youtube', content_ref: 'video-A', timestamp_ms: 9000 } }),
  }), env);
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result).slice(0, 400));
  return { result, calls };
}

// Stage scores: the clicked bag is "Speedy Red 20"; its size sibling is the closest rival.
const realistic = name => name === 'Speedy Red 20' ? [.95, .92] : name === 'Speedy Red 40' ? [.7, .75] : name.startsWith('Speedy') ? [.5, .75] : [.2, .75];

test('a clear winner on a roster of lookalikes becomes Exact after winning the head-to-head round', async () => {
  const { result, calls } = await resolve({ stage: realistic, round: name => name === 'Speedy Red 20' ? [.93, .92] : [.45, .75] });
  assert.equal(result.verified_mapping.hit, true, JSON.stringify(result.verified_mapping).slice(0, 300));
  assert.equal(result.verified_mapping.track_diagnostics.decision_reason, 'visual_confirmed');
  assert.deepEqual(result.verified_mapping.head_to_head, { rivals: 3, outcome: 'visual_confirmed' });
  // Two stage batches for eight candidates, one round.
  assert.deepEqual([calls.stage, calls.round], [2, 1]);
  // Rivals first, front-runner last: list position cannot favour it.
  assert.equal(calls.roundOrder.at(-1), 'Speedy Red 20');
  assert.deepEqual(calls.roundOrder.slice(0, 2), ['Speedy Red 40', 'Speedy Yellow']);
  assert.equal(calls.roundOrder.length, 4);
  const [top] = result.products;
  assert.equal(top.result_class, 'EXACT');
  // The winner is a video-local identity: scoped key, no model number, no "verified SKU" wording.
  assert.match(top.identity_key, /^video-local:/);
  assert.equal(top.model, null);
  assert.ok(!(top.verification_reasons ?? []).some(reason => /verified SKU/i.test(reason)));
  assert.equal(result.products.filter(product => product.result_class === 'EXACT').length, 1);
});

test('a rival that closes in during the round stops the Exact; the likely products are shown as SIMILAR instead', async () => {
  const { result, calls } = await resolve({ stage: realistic, round: name => name === 'Speedy Red 20' ? [.92, .92] : name === 'Speedy Red 40' ? [.85, .8] : [.3, .75] });
  assert.equal(result.verified_mapping.hit, false);
  assert.equal(result.verified_mapping.same_video_reason, 'ambiguous');
  assert.deepEqual(result.verified_mapping.head_to_head, { rivals: 3, outcome: 'ambiguous' });
  assert.equal(calls.round, 1);
  assert.ok(!result.products.some(product => product.result_class === 'EXACT'));
  // Not silence: the roster product the verifier found strongly alike leads the results, labelled SIMILAR.
  const [first] = result.products;
  assert.equal(first.result_class, 'SIMILAR');
  assert.match(first.identity_key, /^roster-candidate:/);
  assert.equal(first.title, 'Louis Vuitton Speedy Red 20');
  assert.match(first.verification_reasons[0], /not confirmed as the exact item/);
  assert.equal(result.state, 'RESULTS');
});

test('a front-runner that fails its second look is not Exact', async () => {
  const { result } = await resolve({ stage: realistic, round: name => name === 'Speedy Red 20' ? [.8, .9] : [.3, .75] });
  assert.equal(result.verified_mapping.hit, false);
  assert.ok(!result.products.some(product => product.result_class === 'EXACT'));
});

test('a candidate the verifier never examined still blocks Exact, and no round is spent', async () => {
  const { result, calls } = await resolve({ stage: realistic, failBatchWith: 'Trunkie' });
  assert.equal(result.verified_mapping.hit, false);
  assert.equal(result.verified_mapping.same_video_reason, 'incomplete_comparison');
  assert.equal(calls.round, 0);
  assert.ok(!result.products.some(product => product.result_class === 'EXACT'));
  assert.ok(result.verified_mapping.roster_retrieval.unresolved_keys.length >= 1);
});

test('nothing strongly alike: no Exact, no roster suggestion', async () => {
  const { result, calls } = await resolve({ stage: () => [.3, .75] });
  assert.equal(result.verified_mapping.hit, false);
  assert.equal(calls.round, 0);
  assert.ok(!result.products.some(product => /^roster-candidate:/.test(product.identity_key ?? '')));
});
