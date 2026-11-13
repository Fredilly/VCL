import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const serverFile = resolve(here, '../src/server.ts');

const description = {
  category: 'apparel',
  subcategory: 'shirt',
  brand_candidate: null,
  model_candidate: null,
  color: 'blue',
  material: '',
  style_attributes: ['button-down'],
  visible_text: [],
  logos_markings: [],
  distinctive_features: [],
  hardware_details: [],
  shape_silhouette: [],
  search_terms: ['blue shirt'],
  confidence: 0.9,
  identity_confidence: 0.2,
};

function requestFor(contentRef = 'youtube:VIDEO') {
  return new Request('https://api.vcl.article6.org/resolve-products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description,
      context: { platform: 'youtube', content_ref: contentRef, timestamp_ms: 10_000 },
    }),
  });
}

test('verified appearance window supplies a missing thumbnail without broad commerce retrieval', async () => {
  const fetches = [];
  const worker = loadModule(serverFile, {
    fetch: async (url) => {
      fetches.push(String(url));
      return new Response(
        '<html><head><meta property="og:image" content="/images/sku-1.jpg"></head></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    },
    console: { error() {}, warn() {} },
  }).default;

  const mapping = [{
    platform: 'youtube',
    content_ref: 'youtube:VIDEO',
    scope: 'time_window',
    timestamp_start_ms: 9000,
    timestamp_end_ms: 11000,
    object_type: 'shirt',
    brand: 'Brand',
    product_id: 'SKU-1',
    title: 'Brand Exact Shirt',
    destination: 'https://brand.example/products/sku-1',
    provenance: 'test_fixture',
  }];

  const response = await worker.fetch(requestFor(), {
    VERIFIED_PRODUCT_MAPPINGS_JSON: JSON.stringify(mapping),
    VERIFIED_PRODUCT_TEST_MODE: 'true',
    BENCHMARK_MODE: 'true',
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].result_class, 'EXACT');
  assert.equal(result.products[0].image_reference, 'https://brand.example/images/sku-1.jpg');
  assert.deepEqual(result.providers_used, []);
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0], 'https://brand.example/products/sku-1');
});

test('verified commerce mapping hydrates its thumbnail and collapses same-SKU seller offers into one Exact card', async () => {
  const { refreshVerifiedOffers } = loadModule(serverFile, { console: { error() {}, warn() {} } });

  const mapping = {
    platform: 'youtube',
    content_ref: 'youtube:VIDEO',
    scope: 'entire_video',
    object_type: 'shirt',
    brand: 'Brand',
    product_id: 'ITEM-EXACT',
    title: 'Verified Shirt',
    destination: 'https://www.ebay.com/itm/ITEM-EXACT',
    image_reference: 'https://i.ebayimg.com/stale-saved.jpg',
    provider: 'admin_verified',
    provenance: 'test_fixture',
  };

  const calls = [];
  const provider = {
    async getItemById(itemId) {
      calls.push(['getItemById', itemId]);
      return {
        id: 'ITEM-EXACT',
        title: 'Verified Shirt source listing',
        brand: 'Brand',
        model: 'SKU-42',
        category: 'shirt',
        image_reference: 'https://i.ebayimg.com/live-source.jpg',
        provenance: 'ebay:browse',
        destination: 'https://www.ebay.com/itm/ITEM-EXACT',
        price: '30.00',
        currency: 'USD',
        result_class: 'RELATED',
        provider: 'ebay',
      };
    },
    async search(query) {
      calls.push(['search', query.query]);
      return [
        {
          id: 'ITEM-EXACT',
          title: 'Verified Shirt source listing',
          brand: 'Brand',
          model: 'SKU-42',
          category: 'shirt',
          image_reference: 'https://i.ebayimg.com/live-source.jpg',
          provenance: 'ebay:browse',
          destination: 'https://www.ebay.com/itm/ITEM-EXACT',
          price: '30.00',
          currency: 'USD',
          result_class: 'RELATED',
          provider: 'ebay',
        },
        {
          id: 'ITEM-EXACT-2',
          title: 'Verified Shirt another seller',
          brand: 'Brand',
          model: 'SKU-42',
          category: 'shirt',
          image_reference: 'https://i.ebayimg.com/second.jpg',
          provenance: 'ebay:browse',
          destination: 'https://www.ebay.com/itm/ITEM-EXACT-2',
          price: '28.00',
          currency: 'USD',
          result_class: 'RELATED',
          provider: 'ebay',
        },
        {
          id: 'ITEM-SIMILAR',
          title: 'Verified Shirt very similar words',
          brand: 'Brand',
          model: 'SKU-99',
          category: 'shirt',
          image_reference: 'https://i.ebayimg.com/similar.jpg',
          provenance: 'ebay:browse',
          destination: 'https://www.ebay.com/itm/ITEM-SIMILAR',
          price: '25.00',
          currency: 'USD',
          result_class: 'SIMILAR',
          provider: 'ebay',
        },
      ];
    },
  };

  const result = await refreshVerifiedOffers([{ name: 'ebay', provider, tier: 'primary' }], mapping);

  assert.deepEqual(calls, [['getItemById', 'ITEM-EXACT'], ['search', 'SKU-42']]);
  assert.equal(result.products.length, 1, 'same-SKU seller offers collapse into one canonical Exact card');
  assert.equal(result.products[0].id, 'ITEM-EXACT');
  assert.equal(result.products[0].image_reference, 'https://i.ebayimg.com/live-source.jpg');
  assert.equal(result.products[0].result_class, 'EXACT');
  assert.equal(result.products.some((product) => product.id === 'ITEM-EXACT-2'), false);
  assert.equal(result.products.some((product) => product.id === 'ITEM-SIMILAR'), false);
  assert.deepEqual(Array.from(result.providers_used), ['ebay']);
  assert.equal(result.commerce_calls.ebay, 2);
});

test('verifier outage stops commerce expansion and hides metadata-only shopping noise', async () => {
  const { resolveProducts } = loadModule(serverFile, { console: { error() {}, warn() {} } });
  let searches = 0;
  const providers = [{ name: 'ebay', tier: 'primary', provider: { search: async () => {
    searches++;
    return [{
      id: 'noisy', title: 'Generic blue shirt', brand: 'Brand', category: 'shirt',
      destination: 'https://merchant.example/noisy',
      image_reference: 'https://merchant.example/noisy.jpg',
      price: null, currency: null, result_class: 'RELATED', provenance: 'commerce',
    }];
  } }}];
  const queries = [
    { query: 'blue shirt', category: 'apparel', subcategory: 'shirt', brand: null, model: null, attributes: [] },
    { query: 'other blue shirt', category: 'apparel', subcategory: 'shirt', brand: null, model: null, attributes: [] },
  ];
  const mockVerifier = async () => ({
    compared: 0, failures: 1, provider_unavailable: 'model_http_404',
    failure_reasons: { model_http_404: 1 }, comparisons: new Map(),
  });
  const result = await resolveProducts(providers, queries, description,
    { VISION_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test-key' },
    undefined, { mimeType: 'image/png', data: btoa('crop') }, mockVerifier);
  assert.equal(searches, 1, 'do not waste commerce calls after verifier outage');
  assert.equal(result.state, 'TEMPORARILY_UNAVAILABLE');
  assert.equal(result.products.length, 0, 'unverified shopping hits must not look like successful matches');
  assert.equal(result.verification.image_failure_reasons.model_http_404, 1);
});

test('alpha SIMILAR-only display downgrades EXACT without promoting unrelated products', () => {
  const { alphaPresentationProducts } = loadModule(serverFile);
  const products = [
    { id: 'matched', result_class: 'EXACT', relationship: 'EXACT', verification_reasons: [] },
    { id: 'similar', result_class: 'SIMILAR', relationship: 'SIMILAR' },
    { id: 'unrelated', result_class: 'RELATED', relationship: 'RELATED' },
  ];
  const result = alphaPresentationProducts(products, { SCOOP_SIMILAR_ONLY: 'true' });
  assert.deepEqual(result.map(p => p.result_class), ['SIMILAR', 'SIMILAR', 'RELATED']);
  assert.equal(result[0].relationship, 'SIMILAR');
  assert.equal(products[0].result_class, 'EXACT', 'do not mutate canonical evidence');
  assert.strictEqual(alphaPresentationProducts(products, { SCOOP_SIMILAR_ONLY: 'false' }), products);
});
