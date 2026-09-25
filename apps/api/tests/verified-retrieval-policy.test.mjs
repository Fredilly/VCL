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

test('verified source page supplies a missing thumbnail without broad commerce retrieval', async () => {
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
    scope: 'entire_video',
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

test('verified commerce mapping queries only its source and returns only the same verified identity', async () => {
  const fetches = [];
  const worker = loadModule(serverFile, {
    fetch: async (url) => {
      const value = String(url);
      fetches.push(value);
      if (value.includes('/identity/v1/oauth2/token')) {
        return Response.json({ access_token: 'token', token_type: 'Application Access Token', expires_in: 7200 });
      }
      if (value.includes('/buy/browse/v1/item_summary/search')) {
        return Response.json({
          itemSummaries: [
            {
              itemId: 'ITEM-EXACT',
              title: 'Verified Shirt exact offer',
              image: { imageUrl: 'https://i.ebayimg.com/exact.jpg' },
              itemWebUrl: 'https://www.ebay.com/itm/ITEM-EXACT-alt',
              price: { value: '30.00', currency: 'USD' },
            },
            {
              itemId: 'ITEM-SIMILAR',
              title: 'Verified Shirt very similar words',
              image: { imageUrl: 'https://i.ebayimg.com/similar.jpg' },
              itemWebUrl: 'https://www.ebay.com/itm/ITEM-SIMILAR',
              price: { value: '25.00', currency: 'USD' },
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${value}`);
    },
    console: { error() {}, warn() {} },
  }).default;

  const mapping = [{
    platform: 'youtube',
    content_ref: 'youtube:VIDEO',
    scope: 'entire_video',
    object_type: 'shirt',
    brand: 'Brand',
    product_id: 'ITEM-EXACT',
    title: 'Verified Shirt',
    destination: 'https://www.ebay.com/itm/ITEM-EXACT',
    image_reference: 'https://i.ebayimg.com/saved.jpg',
    provider: 'ebay',
    provenance: 'test_fixture',
  }];

  const response = await worker.fetch(requestFor(), {
    VERIFIED_PRODUCT_MAPPINGS_JSON: JSON.stringify(mapping),
    VERIFIED_PRODUCT_TEST_MODE: 'true',
    BENCHMARK_MODE: 'true',
    COMMERCE_PROVIDER: 'ebay',
    EBAY_PRODUCTION_CLIENT_ID: 'id',
    EBAY_PRODUCTION_CLIENT_SECRET: 'secret',
    EBAY_ENVIRONMENT: 'production',
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.products[0].id.startsWith('verified:'), true, 'canonical verified product must stay first');
  assert.equal(result.products.every((product) => product.result_class === 'EXACT'), true);
  assert.equal(result.products.some((product) => product.id === 'ITEM-SIMILAR'), false, 'similar title-only offers must not leak into verified results');
  assert.deepEqual(result.providers_used, ['ebay']);
  assert.equal(result.cost_usage.commerce_calls.ebay, 1);
  assert.equal(fetches.some((url) => url.includes('etsy') || url.includes('serpapi') || url.includes('brave')), false);
});
