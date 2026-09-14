import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';
import { apparelCases, example } from './fixtures/apparel-benchmark.mjs';

const file = fileURLToPath(new URL('../src/server.ts', import.meta.url));
const { description, candidate, comparison } = example(apparelCases[0]);
const source = 'data:image/png;base64,AQID';
const credentials = {
  EBAY_SANDBOX_CLIENT_ID: 'sandbox-id', EBAY_SANDBOX_CLIENT_SECRET: 'sandbox-secret',
  EBAY_PRODUCTION_CLIENT_ID: 'production-id', EBAY_PRODUCTION_CLIENT_SECRET: 'production-secret',
};

async function resolve({ environment = 'production', contradiction, withImage = true, browseStatus, missingCredentials = false, readableModel = false } = {}) {
  const calls = [];
  const logs = [];
  const worker = loadModule(file, {
    URLSearchParams,
    console: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args), log: (...args) => logs.push(args) },
    fetch: async (input, options) => {
      const url = new URL(input);
      calls.push(url);
      const host = environment === 'production' ? 'api.ebay.com' : 'api.sandbox.ebay.com';
      if (url.pathname === '/identity/v1/oauth2/token') {
        assert.equal(url.hostname, host);
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Authorization, `Basic ${btoa(`${environment}-id:${environment}-secret`)}`);
        const form = new URLSearchParams(options.body);
        assert.equal(form.get('grant_type'), 'client_credentials');
        assert.equal(form.get('scope'), 'https://api.ebay.com/oauth/api_scope');
        return Response.json({ access_token: 'private-token', expires_in: 7200, token_type: 'Bearer' });
      }
      if (url.pathname === '/buy/browse/v1/item_summary/search') {
        assert.equal(url.hostname, host);
        assert.equal(options.headers.Authorization, 'Bearer private-token');
        assert.equal(options.headers['X-EBAY-C-MARKETPLACE-ID'], 'EBAY_US');
        assert.equal(url.searchParams.get('limit'), '12');
        if (browseStatus) return new Response(null, { status: browseStatus });
        return Response.json({ itemSummaries: [{ itemId: candidate.id, title: candidate.title,
          itemWebUrl: 'https://www.ebay.com/itm/123', image: { imageUrl: candidate.image_reference } }] });
      }
      if (url.hostname === 'generativelanguage.googleapis.com') {
        const body = JSON.parse(options.body);
        assert.equal(body.contents[0].parts[1].inlineData.data, 'AQID', 'selected crop reaches Gemini');
        const observed = structuredClone(comparison.candidate);
        const selected = structuredClone(comparison.source);
        if (readableModel) {
          selected.model = { value: 'Model Q42', confidence: .95, basis: 'image' };
          observed.model = { ...selected.model };
        }
        if (contradiction) observed[contradiction[0]] = { value: contradiction[1], confidence: 0.95, basis: 'image' };
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ source: selected,
          candidates: [{ index: 0, attributes: observed, similarity: 0.95, confidence: 0.95, matching_details: comparison.matching_details }] }) }] } }] });
      }
      assert.equal(input, candidate.image_reference);
      assert.equal(options.headers, undefined, 'candidate image fetch must not receive credentials');
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    },
  }).default;
  const response = await worker.fetch(new Request('https://api.vcl.article6.org/resolve-products', {
    method: 'POST', body: JSON.stringify({ description: readableModel ? { ...description, model_candidate: 'Model Q42',
      visible_text: [...description.visible_text, 'Model Q42'] } : description, source_image: withImage ? source : undefined }),
  }), { ...credentials, ...(missingCredentials ? { EBAY_PRODUCTION_CLIENT_SECRET: undefined } : {}),
    EBAY_ENVIRONMENT: environment, COMMERCE_PROVIDER: 'ebay', GEMINI_API_KEY: 'private-gemini-key' });
  const body = await response.json();
  const exposed = JSON.stringify({ body, logs });
  for (const value of [...Object.values(credentials), 'private-token', 'private-gemini-key']) assert.ok(!exposed.includes(value));
  return { response, body, calls };
}

for (const environment of ['sandbox', 'production']) test(`${environment} credentials reach Browse and multimodal survivors retain eBay provenance`, async () => {
  const { response, body, calls } = await resolve({ environment });
  assert.equal(response.status, 200);
  assert.equal(body.state, 'RESULTS');
  assert.deepEqual(body.providers_used, ['ebay']);
  assert.equal(body.verification.compared, 1, 'repeated offers only compared once');
  assert.equal(calls.filter((url) => url.pathname.includes('/oauth2/')).length, 1);
  assert.equal(body.products.length, 1);
  assert.equal(body.products[0].provider, 'ebay');
  assert.equal(body.products[0].provenance, 'ebay:browse');
  assert.equal(body.products[0].verification_status, 'multimodal');
  assert.equal(body.products[0].result_class, 'SIMILAR', 'brand-only tee fixture has no readable model identity');
});

test('readable source model plus independently compared candidate pixels retain LIKELY through the HTTP route', async () => {
  const { response, body } = await resolve({ readableModel: true });
  assert.equal(response.status, 200);
  assert.equal(body.products.length, 1);
  assert.equal(body.products[0].result_class, 'LIKELY');
  assert.equal(body.products[0].provenance, 'ebay:browse');
});

for (const contradiction of [['brand', 'Adidas'], ['gender', 'women'], ['color', 'red'], ['sleeve', 'long'],
  ['age_group', 'child'], ['subtype', 'dress'], ['category', 'shoes']]) {
  test(`Production eBay image ${contradiction[0]} contradiction survives integration and allows zero survivors`, async () => {
    const { body } = await resolve({ contradiction });
    assert.equal(body.state, 'NO_RESULTS');
    assert.deepEqual(body.products, []);
    assert.equal(body.attempts, 3, 'rejection must allow broadening');
    assert.deepEqual(body.providers_used, ['ebay']);
    assert.equal(body.verification.contradictions[`${contradiction[0]} contradiction`], 1);
  });
}

test('Production eBay metadata-only results retain provenance but cannot become LIKELY or EXACT', async () => {
  const { body } = await resolve({ withImage: false });
  assert.equal(body.products.length, 1);
  assert.equal(body.products[0].provider, 'ebay');
  assert.equal(body.products[0].result_class, 'SIMILAR');
  assert.equal(body.products[0].verification_status, 'metadata_only');
  assert.equal(body.verification.compared, 0);
});

test('Production eBay failure remains unavailable, distinct from verification rejection', async () => {
  const { body } = await resolve({ browseStatus: 429 });
  assert.equal(body.state, 'TEMPORARILY_UNAVAILABLE');
  assert.deepEqual(body.providers_used, ['ebay']);
  assert.equal(body.attempts, 1);
  assert.equal(body.verification.retrieved, 0);
});

test('explicit Production with incomplete credentials cannot use the Sandbox pair', async () => {
  const { response, calls } = await resolve({ missingCredentials: true });
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
});
