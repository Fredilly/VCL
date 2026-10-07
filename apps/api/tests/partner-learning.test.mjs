import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';
const learning = loadModule(new URL('../src/partner-learning.ts', import.meta.url).pathname);
const ledgerMod = loadModule(new URL('../src/verified-product-ledger.ts', import.meta.url).pathname);
const memory = loadModule(new URL('../src/canonical-product-memory.ts', import.meta.url).pathname);
const reuse = loadModule(new URL('../src/same-video-verified-reuse.ts', import.meta.url).pathname);
const catalogMod = loadModule(new URL('../src/partner-catalog.ts', import.meta.url).pathname);
const cross = loadModule(new URL('../src/cross-video-verified-reuse.ts', import.meta.url).pathname);

function environment() {
  const values = new Map();
  const storage = {
    get: async key => values.get(key), put: async (key, value) => values.set(key, value),
    delete: async key => values.delete(key),
    list: async ({ prefix, limit } = {}) => new Map([...values].filter(([key]) => !prefix || key.startsWith(prefix)).slice(0, limit)),
    transaction: async operation => { const before = new Map(values); try { return await operation(storage); } catch (error) { values.clear(); for (const [key, value] of before) values.set(key, value); throw error; } },
  };
  const ledger = new ledgerMod.VerifiedProductLedger({ storage });
  return { values, env: { VERIFIED_PRODUCT_LEDGER: { idFromName: x => x, get: () => ({ fetch: (url, options) => ledger.fetch(new Request(url, options)) }) } } };
}
const catalog = { mimeType: 'image/png', data: btoa('catalog reference bytes') };
const crop = { mimeType: 'image/png', data: btoa('reviewed selected crop bytes') };
const deps = { metadata: async () => ({ title: null, sku: null, canonical_url: null, image_reference: null, price: null, currency: null }), image: async () => catalog };
const offer = (family, sku, color = 'brown', suffix = sku) => ({ destination: `https://catalog.shop/products/${suffix}`, brand: 'Louis Vuitton', title: `Louis Vuitton ${family} ${color} ${sku}`, object_type: 'bag', sku, model: family, family, color, image_reference: `https://images.shop/${sku}.png` });
const input = offers => ({ platform: 'youtube', content_ref: 'video-A', offers });
const visual = (score, color = 'brown') => ({ source: { subtype: { value: 'bag', confidence: .98, basis: 'image' }, color: { value: color, confidence: .98, basis: 'image' } }, candidate: { subtype: { value: 'bag', confidence: .98, basis: 'image' }, color: { value: color, confidence: .98, basis: 'image' } }, similarity: score, confidence: .98, matching_details: ['distinctive panel stitching and clasp construction'] });
const description = { category: 'accessories', subcategory: 'bag', brand_candidate: 'Louis Vuitton', model_candidate: null, color: 'brown', material: 'canvas', visible_text: [], logos_markings: [], distinctive_features: [], shape_silhouette: [], style_attributes: [], hardware_details: [], search_terms: [], confidence: .9, identity_confidence: 0 };

test('all Speedy, Vanity, Neverfull and Trunkie variants survive, duplicate offers merge only by explicit variant', async () => {
  const { env } = environment();
  const offers = [offer('Speedy', 'white-multicolore', 'white'), offer('Speedy', 'p9-silver', 'grey'), offer('Speedy', 'pharrell-yellow', 'yellow'), offer('Vanity', 'white', 'white'), offer('Vanity', 'brown'), offer('Neverfull', 'roses'), offer('Neverfull', 'plain'), offer('Trunkie', 'M14526'), offer('Speedy', 'white-multicolore', 'white', 'another-offer')];
  const rows = await learning.preparePartnerRoster(env, 'https://api.scoop.shop', input(offers), deps);
  assert.equal(rows.length, 8);
  const white = rows.find(row => row.identity.variant_id === 'white-multicolore');
  assert.equal(white.identity.merchant_refs.length, 2);
  assert.ok(rows.every(row => row.mapping.image_reference.includes('/product-reference/')));
  assert.equal(memory.canonicalProductsEquivalent(white.identity, rows.find(row => row.identity.variant_id === 'p9-silver').identity), false);
  await learning.ingestPartnerRoster(env, rows);
  const restored = await ledgerMod.durableVerifiedMappings(env, 'youtube', 'video-A');
  assert.equal(restored.length, 8);
  const saved = await ledgerMod.durableCanonicalProductIdentity(env, white.identity.canonical_key);
  assert.equal(saved.merchant_refs.length, 2);
  assert.ok(await learning.learningImage(env, saved.merchant_refs[0].image_reference.split('/').pop(), true));
});

test('no missing or unreachable image or unknown variant is silently dropped or published', async () => {
  const { env } = environment();
  await assert.rejects(() => learning.preparePartnerRoster(env, 'https://api.scoop.shop', input([offer('Speedy', 'A'), { ...offer('Speedy', 'B'), sku: '' }]), deps), /variant\/SKU/);
  await assert.rejects(() => learning.preparePartnerRoster(env, 'https://api.scoop.shop', input([offer('Speedy', 'A')]), { ...deps, image: async () => null }), /unavailable/);
  assert.equal((await ledgerMod.durableVerifiedMappings(env, 'youtube', 'video-A')).length, 0);
});

test('same model with different colors cannot be consolidated without a catalog variant', () => {
  const a = { title: 'Speedy White', brand: 'Louis Vuitton', model: 'Speedy', object_type: 'bag', visible_text: [], logos_markings: [], color: 'white' };
  assert.equal(memory.canonicalProductsEquivalent(a, { ...a, color: 'yellow' }), false);
});

test('six durable correction assets improve repeat resolution and other-video reuse, without code patches', async () => {
  const { env } = environment();
  const rows = await learning.preparePartnerRoster(env, 'https://api.scoop.shop', input([offer('Speedy', 'old'), offer('Speedy', 'correct')]), deps);
  await learning.ingestPartnerRoster(env, [rows[0]]);
  const key = rows[1].identity.canonical_key;
  const wrong = rows[0].identity.canonical_key;
  const before = { id: 'before', scenario: 'reviewed_correction', timestamp_ms: 9000, description, candidates: [rows[0]], comparisons: { [wrong]: visual(.5) }, expected_class: key, truth: 'IN_ROSTER' };
  assert.equal(reuse.resolveSameVideoReuse({ description, candidates: before.candidates, comparisons: new Map(Object.entries(before.comparisons)) }).mapping, null);
  const cropAsset = await learning.cacheLearningImage(env, crop, 'observation');
  await ledgerMod.persistCanonicalProductIdentity(env, rows[1].identity);
  const build = () => learning.buildCorrectionBundle({ event_id: 'event-1', result_id: 'result-1', action: 'verify_product', reviewed_by: 'admin', crop_asset: cropAsset, platform: 'youtube', content_ref: 'video-A', timestamp_ms: 9000, canonical_product: rows[1].identity, candidates: rows, description, comparisons: { [wrong]: visual(.5), [key]: visual(.98) }, before, newly_learned: true });
  const bundle = await learning.persistCorrectionBundle(env, build());
  assert.equal(bundle.hard_negatives.length, 1);
  assert.ok(bundle.positive_observation && bundle.canonical_product && bundle.regression_case && bundle.appearance && bundle.metrics);
  assert.equal(bundle.metrics.repeat_failure_prevented, true);
  await learning.persistCorrectionBundle(env, build());
  const report = await ledgerMod.verifiedLedgerRequest(env, '/learning/export', {});
  assert.equal(report.metrics.promoted_corrections, 1);
  assert.equal(report.fixtures.length, 1);
  assert.equal(reuse.resolveSameVideoReuse({ description, candidates: report.fixtures[0].candidates, comparisons: new Map(Object.entries(report.fixtures[0].comparisons)) }).canonical_key, key);
  const replayMappings = await ledgerMod.durableVerifiedMappings(env, 'youtube', 'video-A');
  assert.ok(replayMappings.some(row => row.canonical_key === key));
  const storedIdentity = await ledgerMod.durableCanonicalProductIdentity(env, key);
  const candidates = cross.crossVideoCanonicalCandidates({ description: { ...description, model_candidate: 'Speedy' }, identities: [storedIdentity] });
  assert.equal(cross.confirmCrossVideoVisual(candidates, new Map([[key, visual(.98)]])).canonical_key, key);
  const negatives = await ledgerMod.verifiedLedgerRequest(env, '/learning/negatives', { crop_asset: cropAsset, platform: 'youtube', content_ref: 'video-A' });
  assert.equal(negatives.canonical_keys[0], wrong);
  assert.equal((await ledgerMod.verifiedLedgerRequest(env, '/learning/negatives', { crop_asset: cropAsset, platform: 'youtube', content_ref: 'video-B' })).canonical_keys.length, 0);
  assert.equal(await learning.learningImage(env, cropAsset, true), null, 'selected crop must remain private');
  assert.ok(await learning.learningImage(env, cropAsset));
});

test('visual ambiguity, outside-roster and OCR contradiction never become learned Exact', async () => {
  const { env } = environment();
  const rows = await learning.preparePartnerRoster(env, 'https://api.scoop.shop', input([offer('Speedy', 'A'), offer('Speedy', 'B')]), deps);
  const base = { event_id: 'x', result_id: 'y', action: 'hard_negative', reviewed_by: 'admin', crop_asset: 'a'.repeat(64), platform: 'youtube', content_ref: 'video-A', timestamp_ms: 1, canonical_product: rows[0].identity, candidates: rows, description, newly_learned: false };
  for (const comparisons of [{}, Object.fromEntries(rows.map(row => [row.identity.canonical_key, visual(.5)])), Object.fromEntries(rows.map(row => [row.identity.canonical_key, visual(.98)]))]) {
    assert.throws(() => learning.buildCorrectionBundle({ ...base, comparisons }), /trust gate/);
  }
  assert.throws(() => learning.buildCorrectionBundle({ ...base, description: { ...description, visible_text: ['READABLE PRODUCT LOGO LABEL'], model_candidate: 'Speedy' }, comparisons: Object.fromEntries(rows.map(row => [row.identity.canonical_key, visual(.5)])) }), /trust gate/);
});

test('durable references and observation crops span DO value limits without truncation', async () => {
  const { env } = environment();
  const large = { mimeType: 'image/png', data: btoa('x'.repeat(150000)) };
  const key = await learning.cacheLearningImage(env, large, 'catalog');
  assert.equal((await learning.learningImage(env, key)).data, large.data);
});

test('catalog query variants and SKU punctuation remain distinct offer and product identities', async () => {
  const { env } = environment();
  const rows = await learning.preparePartnerRoster(env, 'https://api.scoop.shop', input([
    { ...offer('Speedy', 'A-B'), destination: 'https://catalog.shop/bag?variant=1&utm_source=creator' },
    { ...offer('Speedy', 'A/B'), destination: 'https://catalog.shop/bag?variant=2&utm_source=creator' },
  ]), deps);
  assert.notEqual(rows[0].identity.canonical_key, rows[1].identity.canonical_key);
  assert.notEqual(rows[0].identity.merchant_refs[0].offer_key, rows[1].identity.merchant_refs[0].offer_key);
  await learning.ingestPartnerRoster(env, rows);
  assert.equal((await ledgerMod.durableVerifiedMappings(env, 'youtube', 'video-A')).length, 2);
});

test('API imports and promotes a reviewed correction using cached pixels and real resolver replay', async () => {
  const { env } = environment();
  let server;
  const mockFetch = async (url, options) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === 'api.scoop.shop') return server.default.fetch(new Request(url, options), env);
    if (parsed.hostname === 'catalog.shop') return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    if (parsed.hostname === 'images.shop') return new Response('catalog image bytes', { headers: { 'content-type': 'image/png' } });
    if (parsed.hostname === 'generativelanguage.googleapis.com') {
      const request = JSON.parse(options.body);
      const numbered = request.contents[0].parts.filter(part => part.text).flatMap(part => { try { const record = JSON.parse(part.text); return typeof record.index === 'number' ? [record] : []; } catch { return []; } });
      const attributes = visual(.98).source;
      const response = { source: attributes, candidates: numbered.map(row => ({ index: row.index, attributes, similarity: row.title.includes('correct') ? .98 : .5, confidence: .98, matching_details: ['distinctive panel stitching and clasp construction'] })) };
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }] });
    }
    throw new Error(`Unexpected fetch: ${parsed.hostname}`);
  };
  env.GEMINI_API_KEY = 'test-only';
  env.ADMIN_ACCESS_LEDGER = { idFromName: x => x, get: () => ({ fetch: async () => Response.json({ admin: true, admin_id: 'reviewer' }) }) };
  const item = { event_id: 'reviewed-API', result_id: 'result', feedback_type: 'wrong_item', review_action: 'hard_negative', evidence_key: 'e', platform: 'youtube', content_ref: 'video-A', timestamp_ms: 9000, category: 'accessories', subcategory: 'bag', brand: 'Louis Vuitton', model: null, color: 'brown', material: 'canvas', visible_text: [], logos_markings: [], distinctive_features: [], shape_silhouette: [], style_attributes: [] };
  env.FEEDBACK_LEDGER = { idFromName: x => x, get: () => ({ fetch: async url => String(url).endsWith('/review-item') ? Response.json({ item }) : Response.json({ accepted: true }) }) };
  server = loadModule(new URL('../src/server.ts', import.meta.url).pathname, { fetch: mockFetch });
  const post = (path, body, admin = true) => server.default.fetch(new Request(`https://api.scoop.shop${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(admin ? { 'x-scoop-admin-session': 'test-session' } : {}) }, body: JSON.stringify(body) }), env);
  assert.equal((await post('/partner-roster', input([offer('Speedy', 'old')]), false)).status, 401);
  const imported = await post('/partner-roster', input([offer('Speedy', 'old')]));
  assert.equal(imported.status, 200, await imported.clone().text());
  const promoted = await post('/feedback-promote', { event_id: item.event_id, result_id: item.result_id, source_image: `data:${crop.mimeType};base64,${crop.data}`, product: offer('Speedy', 'correct') });
  assert.equal(promoted.status, 200, await promoted.clone().text());
  const outcome = await promoted.json();
  assert.equal(outcome.learned, true);
  assert.equal(outcome.metrics.repeat_failure_prevented, true);
  assert.equal(outcome.metrics.hard_negatives, 1);
  const report = await (await post('/learning-export', {})).json();
  assert.equal(report.fixtures.length, 1);
  assert.equal(report.fixtures[0].expected_class, outcome.canonical_key);
  const outside = reuse.resolveSameVideoReuse({ description, candidates: report.fixtures[0].candidates, comparisons: new Map(report.fixtures[0].candidates.map(row => [row.identity.canonical_key, visual(.5)])) });
  assert.equal(outside.mapping, null);
  // Future same-frame lookup goes through the deployed HTTP path, with no supplied identity.
  const repeat = await post('/resolve-products', { description, context: { platform: 'youtube', content_ref: 'video-A', timestamp_ms: 9000 }, source_image: `data:${crop.mimeType};base64,${crop.data}` });
  assert.equal(repeat.status, 200, await repeat.clone().text());
  const result = await repeat.json();
  assert.equal(result.verified_mapping.canonical_key, outcome.canonical_key);
});

test('URL-only roster preserves 73 variants, duplicate offers and durable references without SKU code edits', async () => {
  const { env } = environment();
  const urls = Array.from({ length: 73 }, (_, i) => `https://catalog.shop/bag?variant=${i}`);
  urls.push(`${urls[72]}&utm_source=creator`);
  const metadata = async url => {
    const id = new URL(url).searchParams.get('variant');
    return catalogMod.extractPartnerCatalogMetadata(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product', sku: `A-${id}`, brand: { name: 'Acme' }, name: `Orbit ${id} bag`, category: 'bag',
      image: `https://images.shop/${id}.png`, offers: { url: `https://catalog.shop/bag?variant=${id}` },
    })}</script>`, url);
  };
  const rows = await learning.preparePartnerRoster(env, 'https://api.scoop.shop', input(urls), { metadata, image: deps.image });
  assert.equal(rows.length, 73);
  await learning.ingestPartnerRoster(env, rows);
  const mappings = await ledgerMod.durableVerifiedMappings(env, 'youtube', 'video-A');
  assert.equal(mappings.length, 73);
  assert.ok(mappings.every(row => row.image_reference.includes('/product-reference/')));
  assert.ok(rows.every(row => row.identity.variant_id && row.identity.model === null));
});

test('single-SKU imported roster cannot bypass pixels or turn an outside item into Exact', async () => {
  const { env } = environment();
  const rows = await learning.preparePartnerRoster(env, 'https://api.scoop.shop', input([offer('Orbit', 'ONLY')]), deps);
  await learning.ingestPartnerRoster(env, rows);
  env.GEMINI_API_KEY = 'test-only';
  let comparisons = 0;
  let server;
  const mockFetch = async (url, options) => {
    const host = new URL(String(url)).hostname;
    if (host === 'api.scoop.shop') return server.default.fetch(new Request(url, options), env);
    if (host === 'generativelanguage.googleapis.com') {
      comparisons++;
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ source: visual(.4).source,
        candidates: [{ index: 0, attributes: visual(.4).candidate, similarity: .4, confidence: .98, matching_details: [] }] }) }] } }] });
    }
    throw Error(`Unexpected fetch ${host}`);
  };
  server = loadModule(new URL('../src/server.ts', import.meta.url).pathname, { fetch: mockFetch, console: { error() {}, warn() {} } });
  for (const source_image of [undefined, `data:${crop.mimeType};base64,${crop.data}`]) {
    const response = await server.default.fetch(new Request('https://api.scoop.shop/resolve-products', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description,
        context: { platform: 'youtube', content_ref: 'video-A', timestamp_ms: 9000 }, source_image }),
    }), env);
    const result = await response.json();
    assert.ok(!(result.products ?? []).some(row => row.result_class === 'EXACT'));
    assert.ok(!result.verified_mapping?.hit);
  }
  assert.equal(comparisons, 1, 'the roster goes through the independent verifier');
});

test('HTTP resolver compares at most 24 of 73 same-family variants and exposes unresolved coverage', async () => {
  const { env } = environment();
  const rows = await learning.preparePartnerRoster(env, 'https://api.scoop.shop', input(
    Array.from({ length: 73 }, (_, i) => offer('Orbit', `SKU-${i}`))), deps);
  await learning.ingestPartnerRoster(env, rows);
  env.GEMINI_API_KEY = 'test-only'; env.BRAVE_SEARCH_API_KEY = 'test-only';
  const title = reuse.retrieveSameVideoRosterCandidates({ description, candidates: rows })[0].identity.title;
  let verified = 0, modelCalls = 0, server;
  server = loadModule(new URL('../src/server.ts', import.meta.url).pathname, { console: { error() {}, warn() {} },
    fetch: async (url, options) => {
      const host = new URL(String(url)).hostname;
      if (host === 'api.scoop.shop') return server.default.fetch(new Request(url, options), env);
      if (host === 'api.search.brave.com') return Response.json({ web: { results: [] } });
      if (host === 'generativelanguage.googleapis.com') {
        modelCalls++;
        const request = JSON.parse(options.body);
        const products = request.contents[0].parts.flatMap(part => {
          try { const value = JSON.parse(part.text); return typeof value.index === 'number' ? [value] : []; } catch { return []; }
        });
        verified += products.length;
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ source: visual(.98).source,
          candidates: products.map(row => ({ index: row.index, attributes: visual(.98).candidate, confidence: .98,
            similarity: row.title === title ? .98 : .4, matching_details: ['matching panel and clasp construction'] })) }) }] } }] });
      }
      throw Error(`Unexpected fetch ${host}`);
    } });
  const response = await server.default.fetch(new Request('https://api.scoop.shop/resolve-products', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description, source_image: `data:${crop.mimeType};base64,${crop.data}`,
      context: { platform: 'youtube', content_ref: 'video-A', timestamp_ms: 9000 } }),
  }), env);
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(verified, 24);
  assert.equal(modelCalls, 4);
  assert.equal(result.verified_mapping.hit, false);
  assert.equal(result.verified_mapping.same_video_reason, 'incomplete_comparison');
  assert.equal(result.verified_mapping.roster_retrieval.roster_count, 73);
  assert.equal(result.verified_mapping.roster_retrieval.retrieved_keys.length, 24);
  assert.equal(result.verified_mapping.roster_retrieval.unresolved_keys.length, 49);
  assert.ok(!result.products.some(row => row.result_class === 'EXACT'));
});
