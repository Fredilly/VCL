import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mod = loadModule(resolve(here, '../src/product-page-enrichment.ts'));

test('extracts SKU, canonical title, direct URL, and primary image from Product JSON-LD', () => {
  const html = `
    <html><head>
      <link rel="canonical" href="https://www.mizzenandmain.com/products/steel-blue-tonal-texture-leeward-dress-shirt">
      <meta property="og:image" content="https://cdn.shopify.com/fallback.jpg">
      <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"Product",
        "name":"Leeward Dress Shirt - Steel Blue Tonal Texture",
        "sku":"1WS-1916",
        "url":"https://www.mizzenandmain.com/products/steel-blue-tonal-texture-leeward-dress-shirt",
        "image":["https://cdn.shopify.com/s/files/1/0163/4002/files/1WS-1916_Folded.jpg?width=3840"],
        "offers":{"@type":"Offer","price":"138.00","priceCurrency":"USD"}
      }
      </script>
    </head></html>`;

  const metadata = mod.extractProductPageMetadata(
    html,
    'https://www.mizzenandmain.com/products/steel-blue-tonal-texture-leeward-dress-shirt',
  );

  assert.equal(metadata.sku, '1WS-1916');
  assert.equal(metadata.title, 'Leeward Dress Shirt - Steel Blue Tonal Texture');
  assert.equal(metadata.canonical_url, 'https://www.mizzenandmain.com/products/steel-blue-tonal-texture-leeward-dress-shirt');
  assert.equal(metadata.image_reference, 'https://cdn.shopify.com/s/files/1/0163/4002/files/1WS-1916_Folded.jpg?width=3840');
  assert.equal(metadata.price, '138.00');
  assert.equal(metadata.currency, 'USD');
});

test('falls back to Open Graph metadata when JSON-LD product data is absent', () => {
  const html = `
    <html><head>
      <meta property="og:title" content="Example Product &amp; More">
      <meta property="og:url" content="https://shop.example.com/products/example">
      <meta property="og:image" content="/images/example.jpg">
    </head></html>`;

  const metadata = mod.extractProductPageMetadata(html, 'https://shop.example.com/products/example?ref=test');

  assert.equal(metadata.title, 'Example Product & More');
  assert.equal(metadata.canonical_url, 'https://shop.example.com/products/example');
  assert.equal(metadata.image_reference, 'https://shop.example.com/images/example.jpg');
  assert.equal(metadata.sku, null);
});

test('does not trust a cross-domain canonical URL from merchant HTML', () => {
  const html = '<link rel="canonical" href="https://attacker.example/phish"><meta property="og:title" content="Safe product">';
  const metadata = mod.extractProductPageMetadata(html, 'https://shop.example.com/products/safe');
  assert.equal(metadata.canonical_url, 'https://shop.example.com/products/safe');
});


test('falls back to merchant price meta tags when structured offers are absent', () => {
  const html = `
    <html><head>
      <meta property="og:title" content="Example Product">
      <meta property="product:price:amount" content="89.50">
      <meta property="product:price:currency" content="USD">
    </head></html>`;
  const metadata = mod.extractProductPageMetadata(html, 'https://shop.example.com/products/example');
  assert.equal(metadata.price, '89.50');
  assert.equal(metadata.currency, 'USD');
});


test('fetches price metadata beyond the old 800 KB HTML cap', async () => {
  const padding = 'x'.repeat(900_000);
  const html = `<html><head>${padding}<meta property="product:price:amount" content="119.00"><meta property="product:price:currency" content="USD"></head></html>`;
  const fetchImpl = async () => new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  const metadata = await mod.fetchProductPageMetadata(
    'https://www.mizzenandmain.com/products/steel-blue-tonal-texture-leeward-dress-shirt',
    fetchImpl,
  );

  assert.equal(metadata.price, '119.00');
  assert.equal(metadata.currency, 'USD');
});

test('falls back to Shopify product JSON when HTML omits the live price', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('.js')) {
      return new Response(JSON.stringify({
        title: "Kith & '47 Yankees Cap",
        price: 6500,
        price_min: 6500,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('<html><head><script>window.Shopify = { theme: {} }</script><meta property="og:title" content="Kith Cap"></head></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };

  const metadata = await mod.fetchProductPageMetadata(
    'https://kith.com/products/khma050113-001',
    fetchImpl,
  );

  assert.equal(metadata.price, '65.00');
  assert.equal(metadata.currency, 'USD');
  assert.ok(calls.some((url) => url.endsWith('/products/khma050113-001.js')));
});


test('tries product JSON fallback even when Shopify markers are absent', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('.js')) {
      return new Response(JSON.stringify({ price: 6500, price_min: 6500 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('<html><head><meta property="og:title" content="Kith Cap"></head></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };

  const metadata = await mod.fetchProductPageMetadata(
    'https://kith.com/collections/kith-for-the-new-york-yankees-2026/products/khma050113-001',
    fetchImpl,
  );

  assert.equal(metadata.price, '65.00');
  assert.equal(metadata.currency, 'USD');
  assert.ok(calls.some((url) => url.endsWith('/collections/kith-for-the-new-york-yankees-2026/products/khma050113-001.js')));
});


test('known Shopify merchant price uses product JSON before storefront HTML', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('.js')) {
      return new Response(JSON.stringify({ price: 6500, price_min: 6500 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('storefront HTML should not be needed when Shopify JSON has price');
  };

  const metadata = await mod.fetchProductPageMetadata(
    'https://kith.com/collections/kith-for-the-new-york-yankees-2026/products/khma050113-001',
    fetchImpl,
  );

  assert.equal(metadata.price, '65.00');
  assert.equal(metadata.currency, 'USD');
  assert.deepEqual(calls, [
    'https://kith.com/collections/kith-for-the-new-york-yankees-2026/products/khma050113-001.js',
  ]);
});
