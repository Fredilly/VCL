import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const stripImports = (source) => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '');

function loadModule(source, context) {
  const compiled = compile(stripImports(source));
  vm.runInContext(compiled, context);
  return context.exports;
}

const credentialsSource = await readFile(new URL('../src/etsy-credentials.ts', import.meta.url), 'utf8');
const commerceSource = await readFile(new URL('../src/commerce.ts', import.meta.url), 'utf8');
const etsySource = await readFile(new URL('../src/etsy-commerce.ts', import.meta.url), 'utf8');

const commerceContext = vm.createContext({ exports: {} });
vm.runInContext(compile(stripImports(commerceSource)), commerceContext);
const { CommerceNoResultsError, CommerceProviderError } = commerceContext.exports;

function makeEtsyContext(overrides = {}) {
  return vm.createContext({
    exports: {},
    CommerceNoResultsError,
    CommerceProviderError,
    crypto: { randomUUID: () => 'generated-id' },
    URL,
    AbortSignal,
    fetch: overrides.fetch ?? (async () => Response.json({
      count: 1,
      results: [{
        listing_id: 123456789,
        title: 'Handmade Silver Ring',
        url: 'https://www.etsy.com/listing/123456789/handmade-silver-ring',
        description: 'A handcrafted sterling silver ring.',
        price: { amount: '4500', divisor: 100, currency_code: 'USD' },
        tags: ['silver', 'ring', 'handmade'],
        materials: ['sterling silver'],
        taxonomy_id: 123,
        created_timestamp: Math.floor(Date.now() / 1000),
        updated_timestamp: Math.floor(Date.now() / 1000),
      }],
    })),
    Date,
    console,
    ...overrides,
  });
}

const query = { query: 'silver ring', category: 'jewelry', subcategory: 'rings', brand: null, model: null, attributes: [] };
const fashionQuery = { query: 'cotton t-shirt', category: 'apparel', subcategory: 'tops', brand: 'Nike', model: 'Air Max', attributes: [] };
const ineligibleQuery = { query: 'laptop charger', category: 'electronics', subcategory: 'computers', brand: null, model: null, attributes: [] };

const validCreds = { apiKey: 'test-keystring', sharedSecret: 'test-shared-secret' };

// ── Credentials tests ──

test('credentials: resolveEtsyCredentials returns credentials when both env vars present', () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveEtsyCredentials({ ETSY_KEYSTRING: 'key', ETSY_SHARED_SECRET: 'secret' });
  assert.ok(creds, 'should return credentials');
  assert.equal(creds.apiKey, 'key');
  assert.equal(creds.sharedSecret, 'secret');
});

test('credentials: resolveEtsyCredentials returns null when keystring missing', () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveEtsyCredentials({ ETSY_SHARED_SECRET: 'secret' });
  assert.equal(creds, null);
});

test('credentials: resolveEtsyCredentials returns null when shared secret missing', () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveEtsyCredentials({ ETSY_KEYSTRING: 'key' });
  assert.equal(creds, null);
});

test('credentials: resolveEtsyCredentials returns null when both missing', () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveEtsyCredentials({});
  assert.equal(creds, null);
});

// ── Category eligibility tests ──

test('category eligibility: jewelry category is eligible', async () => {
  const ctx = makeEtsyContext();
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const results = await provider.search(query);
  assert.ok(results.length > 0, 'should return results for jewelry category');
  assert.equal(results[0].provider, 'etsy');
});

test('category eligibility: apparel category is eligible', async () => {
  const ctx = makeEtsyContext({
    fetch: async (url) => {
      const urlStr = String(url);
      assert.ok(urlStr.includes('keywords=cotton+t-shirt'), 'should include keywords in URL');
      return Response.json({
        count: 1,
        results: [{
          listing_id: 222,
          title: 'Cotton T-Shirt',
          url: 'https://www.etsy.com/listing/222',
          price: { amount: '2500', divisor: 100, currency_code: 'USD' },
          created_timestamp: Math.floor(Date.now() / 1000),
        }],
      });
    },
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const results = await provider.search(fashionQuery);
  assert.ok(results.length > 0);
});

test('category eligibility: ineligible category returns empty array', async () => {
  const ctx = makeEtsyContext();
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const results = await provider.search(ineligibleQuery);
  assert.ok(Array.isArray(results), 'should return an array');
  assert.equal(results.length, 0, 'should return empty array for ineligible category');
});

test('category eligibility: vintage in query text makes query eligible', async () => {
  const vintageQuery = { query: 'vintage leather bag', category: 'other', subcategory: 'other', brand: null, model: null, attributes: [] };
  const ctx = makeEtsyContext();
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const results = await provider.search(vintageQuery);
  assert.ok(results.length > 0, 'should return results when vintage in query text');
});

test('category eligibility: handmade in query text makes query eligible', async () => {
  const handmadeQuery = { query: 'handmade wooden bowl', category: 'other', subcategory: 'other', brand: null, model: null, attributes: [] };
  const ctx = makeEtsyContext();
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const results = await provider.search(handmadeQuery);
  assert.ok(results.length > 0, 'should return results when handmade in query text');
});

// ── Normalization tests ──

test('adapter: normalizes candidates and never emits EXACT', async () => {
  const ctx = makeEtsyContext();
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [candidate] = await provider.search(query);
  assert.equal(candidate.title, 'Handmade Silver Ring');
  assert.equal(candidate.result_class, 'SIMILAR');
  assert.notEqual(candidate.result_class, 'EXACT');
  assert.equal(candidate.price, '45.00');
  assert.equal(candidate.currency, 'USD');
  assert.equal(candidate.provenance, 'etsy:listings');
  assert.equal(candidate.provider, 'etsy');
});

test('adapter: preserves direct Etsy listing URL as destination', async () => {
  const ctx = makeEtsyContext();
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [candidate] = await provider.search(query);
  assert.equal(candidate.destination, 'https://www.etsy.com/listing/123456789/handmade-silver-ring');
});

test('adapter: listing_id converted to string for id', async () => {
  const ctx = makeEtsyContext();
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [candidate] = await provider.search(query);
  assert.equal(candidate.id, '123456789');
});

test('adapter: missing price defaults to null', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({
      count: 1,
      results: [{
        listing_id: 1,
        title: 'Item Without Price',
        url: 'https://www.etsy.com/listing/1',
        created_timestamp: Math.floor(Date.now() / 1000),
      }],
    }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [result] = await provider.search(query);
  assert.equal(result.price, null);
  assert.equal(result.currency, null);
});

test('adapter: tags become category metadata', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({
      count: 1,
      results: [{
        listing_id: 3,
        title: 'Item With Tags',
        url: 'https://www.etsy.com/listing/3',
        tags: ['silver', 'ring', 'handmade', 'jewelry', 'gift', 'extra'],
        price: { amount: '1000', divisor: 100, currency_code: 'USD' },
        created_timestamp: Math.floor(Date.now() / 1000),
      }],
    }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [result] = await provider.search(query);
  assert.equal(result.metadata.category, 'silver, ring, handmade, jewelry, gift');
});

test('adapter: materials becomes material metadata', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({
      count: 1,
      results: [{
        listing_id: 4,
        title: 'Item With Materials',
        url: 'https://www.etsy.com/listing/4',
        materials: ['sterling silver', 'gold plated'],
        price: { amount: '2000', divisor: 100, currency_code: 'USD' },
        created_timestamp: Math.floor(Date.now() / 1000),
      }],
    }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [result] = await provider.search(query);
  assert.equal(result.metadata.material, 'sterling silver');
});

test('adapter: result_class is LIKELY when brand and model in title', async () => {
  const brandQuery = { query: 'Nike Air Max', category: 'shoes', subcategory: 'sneakers', brand: 'Nike', model: 'Air Max', attributes: [] };
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({
      count: 1,
      results: [{
        listing_id: 5,
        title: 'Nike Air Max 90 Sneakers',
        url: 'https://www.etsy.com/listing/5',
        price: { amount: '12000', divisor: 100, currency_code: 'USD' },
        created_timestamp: Math.floor(Date.now() / 1000),
      }],
    }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [result] = await provider.search(brandQuery);
  assert.equal(result.result_class, 'LIKELY');
});

test('adapter: result_class is SIMILAR when brand/model not in title', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({
      count: 1,
      results: [{
        listing_id: 6,
        title: 'Generic Silver Ring',
        url: 'https://www.etsy.com/listing/6',
        price: { amount: '3000', divisor: 100, currency_code: 'USD' },
        created_timestamp: Math.floor(Date.now() / 1000),
      }],
    }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [result] = await provider.search(query);
  assert.equal(result.result_class, 'SIMILAR');
});

// ── Freshness tests (old listings are accepted — no age filter) ──

test('listing age: old listings are not rejected', async () => {
  const veryOld = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({
      count: 1,
      results: [{
        listing_id: 100,
        title: 'Old Listing',
        url: 'https://www.etsy.com/listing/100',
        price: { amount: '1000', divisor: 100, currency_code: 'USD' },
        updated_timestamp: veryOld,
      }],
    }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const results = await provider.search(query);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Old Listing');
});

test('listing age: listings with no timestamp are accepted', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({
      count: 1,
      results: [{
        listing_id: 300,
        title: 'No Timestamp Listing',
        url: 'https://www.etsy.com/listing/300',
        price: { amount: '1500', divisor: 100, currency_code: 'USD' },
      }],
    }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const results = await provider.search(query);
  assert.equal(results.length, 1);
});

// ── Failure state tests ──

test('missing credentials: returns empty when no keystring', async () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveEtsyCredentials({});
  assert.equal(creds, null);
});

test('access unavailable: 403 throws CommerceProviderError', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => new Response('Forbidden', { status: 403, statusText: 'Forbidden' }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /403/);
    return true;
  });
});

test('no results: empty results throws CommerceNoResultsError', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({ count: 0, results: [] }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'NO_RESULTS');
    return true;
  });
});

test('no results: missing results field throws CommerceNoResultsError', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({ count: 0 }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'NO_RESULTS');
    return true;
  });
});

test('timeout: throws CommerceProviderError', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => { throw new Error('The operation was aborted'); },
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    return true;
  });
});

test('rate limited: 429 throws CommerceProviderError', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => new Response('Too Many Requests', { status: 429, statusText: 'Too Many Requests' }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /429/);
    return true;
  });
});

test('malformed response: invalid JSON throws CommerceProviderError', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => new Response('not json at all', { status: 200 }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /invalid JSON/);
    return true;
  });
});

test('provider error: HTTP 500 throws CommerceProviderError', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /500/);
    return true;
  });
});

test('network error: throws CommerceProviderError', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => { throw new TypeError('fetch failed'); },
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    return true;
  });
});

// ── Quota / rate-limit metadata tests ──

test('rate limit info: captures headers from response', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => {
      const response = Response.json({
        count: 1,
        results: [{
          listing_id: 1,
          title: 'Test',
          url: 'https://www.etsy.com/listing/1',
          price: { amount: '1000', divisor: 100, currency_code: 'USD' },
          created_timestamp: Math.floor(Date.now() / 1000),
        }],
      });
      response.headers.set('x-rate-limit-limit', '10000');
      response.headers.set('x-rate-limit-remaining', '9924');
      response.headers.set('x-limit-per-second', '10');
      response.headers.set('x-remaining-this-second', '9');
      return response;
    },
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  await provider.search(query);
  const rateLimit = provider.getRateLimitInfo();
  assert.equal(rateLimit.limitPerDay, 10000);
  assert.equal(rateLimit.remainingToday, 9924);
  assert.equal(rateLimit.limitPerSecond, 10);
  assert.equal(rateLimit.remainingThisSecond, 9);
});

test('rate limit info: handles missing headers gracefully', async () => {
  const ctx = makeEtsyContext();
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  await provider.search(query);
  const rateLimit = provider.getRateLimitInfo();
  assert.equal(rateLimit.limitPerDay, undefined);
  assert.equal(rateLimit.remainingToday, undefined);
});

// ── Items without title filtered ──

test('adapter: items without title are filtered out', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({
      count: 3,
      results: [
        { listing_id: 1, title: 'Valid Item', url: 'https://www.etsy.com/listing/1', price: { amount: '1000', divisor: 100, currency_code: 'USD' }, created_timestamp: Math.floor(Date.now() / 1000) },
        { listing_id: 2, url: 'https://www.etsy.com/listing/2', price: { amount: '2000', divisor: 100, currency_code: 'USD' }, created_timestamp: Math.floor(Date.now() / 1000) },
        { listing_id: 3, title: '', url: 'https://www.etsy.com/listing/3', price: { amount: '3000', divisor: 100, currency_code: 'USD' }, created_timestamp: Math.floor(Date.now() / 1000) },
      ],
    }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const results = await provider.search(query);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Valid Item');
});

// ── Price parsing edge cases ──

test('adapter: handles price with divisor 1', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({
      count: 1,
      results: [{
        listing_id: 10,
        title: 'Item',
        url: 'https://www.etsy.com/listing/10',
        price: { amount: '25', divisor: 1, currency_code: 'USD' },
        created_timestamp: Math.floor(Date.now() / 1000),
      }],
    }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [result] = await provider.search(query);
  assert.equal(result.price, '25.00');
});

test('adapter: handles missing divisor as 100', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({
      count: 1,
      results: [{
        listing_id: 11,
        title: 'Item',
        url: 'https://www.etsy.com/listing/11',
        price: { amount: '5000', currency_code: 'EUR' },
        created_timestamp: Math.floor(Date.now() / 1000),
      }],
    }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [result] = await provider.search(query);
  assert.equal(result.price, '50.00');
  assert.equal(result.currency, 'EUR');
});

test('adapter: non-numeric price amount defaults to null', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({
      count: 1,
      results: [{
        listing_id: 12,
        title: 'Item',
        url: 'https://www.etsy.com/listing/12',
        price: { amount: 'not-a-number', divisor: 100, currency_code: 'USD' },
        created_timestamp: Math.floor(Date.now() / 1000),
      }],
    }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [result] = await provider.search(query);
  assert.equal(result.price, null);
  assert.equal(result.currency, null);
});

// ── Provenance and destination tests ──

test('adapter: provenance is etsy:listings', async () => {
  const ctx = makeEtsyContext();
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [candidate] = await provider.search(query);
  assert.equal(candidate.provenance, 'etsy:listings');
});

test('adapter: provider is etsy', async () => {
  const ctx = makeEtsyContext();
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [candidate] = await provider.search(query);
  assert.equal(candidate.provider, 'etsy');
});

test('adapter: destination is direct Etsy URL', async () => {
  const ctx = makeEtsyContext();
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [candidate] = await provider.search(query);
  assert.ok(candidate.destination?.startsWith('https://www.etsy.com/listing/'), 'destination should be Etsy listing URL');
});

// ── API request verification tests ──

test('adapter: sends correct x-api-key header', async () => {
  let capturedHeaders = {};
  const ctx = makeEtsyContext({
    fetch: async (url, opts) => {
      capturedHeaders = opts?.headers ?? {};
      return Response.json({ count: 0, results: [] });
    },
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  try { await provider.search(query); } catch {}
  assert.equal(capturedHeaders['x-api-key'], 'test-keystring:test-shared-secret');
});

test('adapter: sends correct Accept header', async () => {
  let capturedHeaders = {};
  const ctx = makeEtsyContext({
    fetch: async (url, opts) => {
      capturedHeaders = opts?.headers ?? {};
      return Response.json({ count: 0, results: [] });
    },
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  try { await provider.search(query); } catch {}
  assert.equal(capturedHeaders['Accept'], 'application/json');
});

test('adapter: request URL includes keywords and sort parameters', async () => {
  let capturedUrl = '';
  const ctx = makeEtsyContext({
    fetch: async (url) => {
      capturedUrl = String(url);
      return Response.json({ count: 0, results: [] });
    },
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  try { await provider.search(query); } catch {}
  assert.ok(capturedUrl.includes('keywords=silver+ring'), 'should include keywords');
  assert.ok(capturedUrl.includes('sort_on=score'), 'should sort by score');
  assert.ok(capturedUrl.includes('is_safe=true'), 'should include is_safe');
  assert.ok(capturedUrl.includes('limit=12'), 'should limit to 12');
});

// ── Cap at 12 results ──

test('adapter: caps at 12 results', async () => {
  const items = Array.from({ length: 15 }, (_, i) => ({
    listing_id: i + 1000,
    title: `Item ${i}`,
    url: `https://www.etsy.com/listing/${i + 1000}`,
    price: { amount: '1000', divisor: 100, currency_code: 'USD' },
    created_timestamp: Math.floor(Date.now() / 1000),
  }));
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({ count: 15, results: items }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const results = await provider.search(query);
  assert.equal(results.length, 12);
});

// ── Etsy failure never fails the resolver ──

test('adapter: throws typed errors that resolver can catch', async () => {
  const ctx = makeEtsyContext({
    fetch: async () => new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  try {
    await provider.search(query);
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof CommerceProviderError, 'should throw CommerceProviderError');
    assert.equal(error.code, 'COMMERCE_PROVIDER_ERROR');
  }
});

// ── Description truncation ──

test('adapter: truncates description to 800 chars in metadata', async () => {
  const longDescription = 'A'.repeat(1000);
  const ctx = makeEtsyContext({
    fetch: async () => Response.json({
      count: 1,
      results: [{
        listing_id: 50,
        title: 'Item With Long Description',
        url: 'https://www.etsy.com/listing/50',
        description: longDescription,
        price: { amount: '1000', divisor: 100, currency_code: 'USD' },
        created_timestamp: Math.floor(Date.now() / 1000),
      }],
    }),
  });
  loadModule(etsySource, ctx);
  const { EtsyCommerceProvider } = ctx.exports;

  const provider = new EtsyCommerceProvider(validCreds);
  const [result] = await provider.search(query);
  assert.equal(result.metadata.description.length, 800);
});
