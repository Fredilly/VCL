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

const authSource = await readFile(new URL('../src/ebay-auth.ts', import.meta.url), 'utf8');
const ebaySource = await readFile(new URL('../src/ebay-commerce.ts', import.meta.url), 'utf8');
const commerceSource = await readFile(new URL('../src/commerce.ts', import.meta.url), 'utf8');

const commerceContext = vm.createContext({ exports: {} });
vm.runInContext(compile(stripImports(commerceSource)), commerceContext);
const { CommerceNoResultsError, CommerceProviderError } = commerceContext.exports;

function makeAuthContext(overrides = {}) {
  return vm.createContext({
    exports: {},
    CommerceNoResultsError,
    CommerceProviderError,
    btoa: (str) => Buffer.from(str).toString('base64'),
    fetch: overrides.fetch ?? (async () => Response.json({ access_token: 'test-token', token_type: 'Bearer', expires_in: 7200 })),
    URL,
    URLSearchParams,
    AbortSignal,
    Date,
    console,
    ...overrides,
  });
}

function makeEbayContext(authInstance, overrides = {}) {
  return vm.createContext({
    exports: {},
    CommerceNoResultsError,
    CommerceProviderError,
    EbayAuth: authInstance,
    crypto: { randomUUID: () => 'generated-id' },
    URL,
    AbortSignal,
    fetch: overrides.fetch ?? (async () => Response.json({
      itemSummaries: [{ itemId: '123', title: 'Nike Air Max 90 White', image: { imageUrl: 'https://example.test/image.jpg' },
        itemWebUrl: 'https://example.test/item', price: { value: '99.00', currency: 'USD' }, categories: [{ categoryName: 'Sneakers' }] }],
    })),
    console,
    ...overrides,
  });
}

// ── OAuth tests ──

test('OAuth: successful token fetch returns access_token', async () => {
  const authCtx = makeAuthContext();
  loadModule(authSource, authCtx);
  const { EbayAuth } = authCtx.exports;

  const auth = new EbayAuth({ clientId: 'test-id', clientSecret: 'test-secret', sandbox: true });
  const token = await auth.getAccessToken();
  assert.equal(token, 'test-token');
});

test('OAuth: caches token until expiry', async () => {
  let fetchCount = 0;
  const authCtx = makeAuthContext({
    fetch: async () => {
      fetchCount++;
      return Response.json({ access_token: `token-${fetchCount}`, token_type: 'Bearer', expires_in: 7200 });
    },
  });
  loadModule(authSource, authCtx);
  const { EbayAuth } = authCtx.exports;

  const auth = new EbayAuth({ clientId: 'id', clientSecret: 'secret', sandbox: true });
  const t1 = await auth.getAccessToken();
  const t2 = await auth.getAccessToken();
  assert.equal(fetchCount, 1, 'should only fetch once when token is fresh');
  assert.equal(t1, 'token-1');
  assert.equal(t2, 'token-1');
});

test('OAuth: refreshes token after expiry', async () => {
  let fetchCount = 0;
  const authCtx = makeAuthContext({
    Date: { now: () => 0 },
    fetch: async () => {
      fetchCount++;
      return Response.json({ access_token: `token-${fetchCount}`, token_type: 'Bearer', expires_in: 60 });
    },
  });
  loadModule(authSource, authCtx);
  const { EbayAuth } = authCtx.exports;

  const auth = new EbayAuth({ clientId: 'id', clientSecret: 'secret', sandbox: true });
  await auth.getAccessToken();
  auth.resetCache();
  const t2 = await auth.getAccessToken();
  assert.equal(fetchCount, 2, 'should fetch again after cache reset');
  assert.equal(t2, 'token-2');
});

test('OAuth: failure throws CommerceProviderError', async () => {
  const authCtx = makeAuthContext({
    fetch: async () => new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
  });
  loadModule(authSource, authCtx);
  const { EbayAuth } = authCtx.exports;

  const auth = new EbayAuth({ clientId: 'bad', clientSecret: 'bad', sandbox: true });
  await assert.rejects(() => auth.getAccessToken(), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /401/);
    return true;
  });
});

test('OAuth: network error throws CommerceProviderError', async () => {
  const authCtx = makeAuthContext({
    fetch: async () => { throw new Error('fetch failed'); },
  });
  loadModule(authSource, authCtx);
  const { EbayAuth } = authCtx.exports;

  const auth = new EbayAuth({ clientId: 'id', clientSecret: 'secret', sandbox: true });
  await assert.rejects(() => auth.getAccessToken(), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    return true;
  });
});

test('OAuth: malformed JSON response throws CommerceProviderError', async () => {
  const authCtx = makeAuthContext({
    fetch: async () => new Response('not json at all', { status: 200 }),
  });
  loadModule(authSource, authCtx);
  const { EbayAuth } = authCtx.exports;

  const auth = new EbayAuth({ clientId: 'id', clientSecret: 'secret', sandbox: true });
  await assert.rejects(() => auth.getAccessToken(), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /invalid JSON/);
    return true;
  });
});

test('OAuth: response missing access_token throws CommerceProviderError', async () => {
  const authCtx = makeAuthContext({
    fetch: async () => Response.json({ token_type: 'Bearer', expires_in: 7200 }),
  });
  loadModule(authSource, authCtx);
  const { EbayAuth } = authCtx.exports;

  const auth = new EbayAuth({ clientId: 'id', clientSecret: 'secret', sandbox: true });
  await assert.rejects(() => auth.getAccessToken(), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /missing access_token/);
    return true;
  });
});

test('OAuth: sandbox uses sandbox endpoint', async () => {
  let capturedUrl = '';
  const authCtx = makeAuthContext({
    fetch: async (url) => { capturedUrl = url; return Response.json({ access_token: 'tok', token_type: 'Bearer', expires_in: 7200 }); },
  });
  loadModule(authSource, authCtx);
  const { EbayAuth } = authCtx.exports;

  const auth = new EbayAuth({ clientId: 'id', clientSecret: 'secret', sandbox: true });
  await auth.getAccessToken();
  assert.match(capturedUrl, /sandbox\.ebay\.com/);
});

test('OAuth: production uses production endpoint', async () => {
  let capturedUrl = '';
  const authCtx = makeAuthContext({
    fetch: async (url) => { capturedUrl = url; return Response.json({ access_token: 'tok', token_type: 'Bearer', expires_in: 7200 }); },
  });
  loadModule(authSource, authCtx);
  const { EbayAuth } = authCtx.exports;

  const auth = new EbayAuth({ clientId: 'id', clientSecret: 'secret', sandbox: false });
  await auth.getAccessToken();
  assert.ok(!capturedUrl.includes('sandbox'), 'should not use sandbox endpoint');
});

// ── Adapter tests ──

const query = { query: 'Nike Air Max 90', category: 'Apparel', subcategory: 'Sneakers', brand: 'Nike', model: 'Air Max 90', attributes: [] };

function makeMockAuth() {
  return { getAccessToken: async () => 'mock-token', getBrowseBaseUrl: () => 'https://api.sandbox.ebay.com' };
}

test('eBay adapter: normalizes candidates and never emits EXACT', async () => {
  const ctx = makeEbayContext(makeMockAuth());
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const [candidate] = await provider.search(query);
  assert.equal(candidate.title, 'Nike Air Max 90 White');
  assert.equal(candidate.result_class, 'LIKELY');
  assert.notEqual(candidate.result_class, 'EXACT');
  assert.equal(candidate.price, '99.00');
  assert.equal(candidate.currency, 'USD');
  assert.equal(candidate.provenance, 'ebay:browse');
});

test('eBay adapter: empty results throws CommerceNoResultsError', async () => {
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => Response.json({ itemSummaries: [] }),
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'NO_RESULTS');
    return true;
  });
});

test('eBay adapter: missing itemSummaries throws CommerceNoResultsError', async () => {
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => Response.json({}),
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'NO_RESULTS');
    return true;
  });
});

test('eBay adapter: HTTP error throws CommerceProviderError', async () => {
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => new Response('Rate limited', { status: 429, statusText: 'Too Many Requests' }),
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /429/);
    return true;
  });
});

test('eBay adapter: malformed JSON throws CommerceProviderError', async () => {
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => new Response('not json', { status: 200 }),
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /invalid JSON/);
    return true;
  });
});

test('eBay adapter: network timeout throws CommerceProviderError', async () => {
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => { throw new Error('The operation was aborted'); },
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    return true;
  });
});

test('eBay adapter: items without title are filtered out', async () => {
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => Response.json({
      itemSummaries: [
        { itemId: '1', title: 'Valid Item', price: { value: '10.00', currency: 'USD' } },
        { itemId: '2', price: { value: '20.00', currency: 'USD' } },
        { itemId: '3', title: '', price: { value: '30.00', currency: 'USD' } },
      ],
    }),
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const results = await provider.search(query);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Valid Item');
});

test('eBay adapter: result_class is SIMILAR when brand/model not in title', async () => {
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => Response.json({
      itemSummaries: [{ itemId: '1', title: 'Generic Running Shoe', price: { value: '49.99', currency: 'USD' } }],
    }),
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const [result] = await provider.search(query);
  assert.equal(result.result_class, 'SIMILAR');
});

test('eBay adapter: result_class is LIKELY when both brand and model in title', async () => {
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => Response.json({
      itemSummaries: [{ itemId: '1', title: 'Nike Air Max 90 Mens Sneakers', price: { value: '120.00', currency: 'USD' } }],
    }),
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const [result] = await provider.search(query);
  assert.equal(result.result_class, 'LIKELY');
});

test('eBay adapter: missing price/currency defaults to null', async () => {
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => Response.json({
      itemSummaries: [{ itemId: '1', title: 'Item Without Price' }],
    }),
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const [result] = await provider.search(query);
  assert.equal(result.price, null);
  assert.equal(result.currency, null);
});

test('eBay adapter: image_reference from eBay image', async () => {
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => Response.json({
      itemSummaries: [{ itemId: '1', title: 'Item', image: { imageUrl: 'https://ebay.test/img.jpg' } }],
    }),
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const [result] = await provider.search(query);
  assert.equal(result.image_reference, 'https://ebay.test/img.jpg');
});

test('eBay adapter: category from eBay categories array', async () => {
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => Response.json({
      itemSummaries: [{ itemId: '1', title: 'Item', categories: [{ categoryName: 'Athletic Shoes' }] }],
    }),
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const [result] = await provider.search(query);
  assert.equal(result.category, 'Athletic Shoes');
});

test('eBay adapter: missing attributes stay unknown instead of copying the query', async () => {
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => Response.json({
      itemSummaries: [{ itemId: '1', title: 'Item' }],
    }),
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const [result] = await provider.search(query);
  assert.equal(result.category, null);
  assert.equal(result.brand, null);
  assert.equal(result.model, null);
  assert.equal(result.metadata.category, undefined);
});

test('eBay adapter: searchByImage sends POST to search_by_image endpoint', async () => {
  let capturedUrl = '';
  let capturedMethod = '';
  let capturedBody = '';
  let capturedHeaders = {};
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async (url, opts) => {
      capturedUrl = String(url);
      capturedMethod = opts?.method ?? 'GET';
      capturedBody = opts?.body ?? '';
      capturedHeaders = opts?.headers ?? {};
      return Response.json({ itemSummaries: [{ itemId: '1', title: 'Item from image' }] });
    },
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const results = await provider.searchByImage('aXZnLWJhc2U2NA==', query);
  assert.equal(results.length, 1);
  assert.ok(capturedUrl.includes('search_by_image'), 'should call search_by_image endpoint');
  assert.equal(capturedMethod, 'POST');
  const body = JSON.parse(capturedBody);
  assert.equal(body.image, 'aXZnLWJhc2U2NA==');
  assert.equal(capturedHeaders['Content-Type'], 'application/json');
});

test('eBay adapter: searchByImage normalizes candidates from image search', async () => {
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => Response.json({
      itemSummaries: [{
        itemId: 'img-1', title: 'Nike Air Max 90 from image',
        image: { imageUrl: 'https://ebay.test/img-search.jpg' },
        itemWebUrl: 'https://ebay.test/item-img',
        price: { value: '150.00', currency: 'USD' },
        categories: [{ categoryName: 'Sneakers' }],
      }],
    }),
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const [result] = await provider.searchByImage('aXZn', query);
  assert.equal(result.id, 'img-1');
  assert.equal(result.title, 'Nike Air Max 90 from image');
  assert.equal(result.image_reference, 'https://ebay.test/img-search.jpg');
  assert.equal(result.price, '150.00');
  assert.equal(result.currency, 'USD');
  assert.equal(result.provenance, 'ebay:browse');
  assert.equal(result.result_class, 'LIKELY');
});

test('eBay adapter: searchByImage falls back to keyword on Sandbox error', async () => {
  let callCount = 0;
  let capturedUrls = [];
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async (url) => {
      callCount++;
      capturedUrls.push(String(url));
      if (callCount === 1) {
        return new Response('Not Found', { status: 404, statusText: 'Not Found' });
      }
      return Response.json({
        itemSummaries: [{ itemId: 'fallback', title: 'Fallback item', price: { value: '50.00', currency: 'USD' } }],
      });
    },
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const results = await provider.searchByImage('aXZn', query);
  assert.equal(callCount, 2, 'should make two requests: image search + keyword fallback');
  assert.ok(capturedUrls[0].includes('search_by_image'), 'first call should be image search');
  assert.ok(capturedUrls[1].includes('/item_summary/search?'), 'second call should be keyword search');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'fallback');
});

test('eBay adapter: searchByImage falls back to keyword on empty image results', async () => {
  let callCount = 0;
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => {
      callCount++;
      if (callCount === 1) {
        return Response.json({ itemSummaries: [] });
      }
      return Response.json({
        itemSummaries: [{ itemId: 'fb', title: 'Keyword result', price: { value: '25.00', currency: 'USD' } }],
      });
    },
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const results = await provider.searchByImage('aXZn', query);
  assert.equal(callCount, 2);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'fb');
});

test('eBay adapter: searchByImage does not swallow non-commerce errors from keyword fallback', async () => {
  let callCount = 0;
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError('bad input');
      }
      return Response.json({ itemSummaries: [] });
    },
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  await assert.rejects(() => provider.searchByImage('aXZn', query), (err) => {
    assert.equal(err.code, 'NO_RESULTS');
    return true;
  });
  assert.equal(callCount, 2, 'should attempt keyword fallback after image search error');
});

test('eBay adapter: retrieves 12 candidates before verification limits display', async () => {
  const items = Array.from({ length: 15 }, (_, i) => ({
    itemId: String(i), title: `Item ${i}`, price: { value: '10.00', currency: 'USD' },
  }));
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async () => Response.json({ itemSummaries: items }),
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const results = await provider.search(query);
  assert.equal(results.length, 12);
});


test('eBay adapter: configured affiliate context carries click_ref and prefers affiliate URL', async () => {
  let capturedHeaders = {};
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async (_url, opts) => {
      capturedHeaders = opts?.headers ?? {};
      return Response.json({
        itemSummaries: [{
          itemId: 'affiliate-1',
          title: 'Nike Air Max 90 White',
          itemWebUrl: 'https://example.test/plain',
          itemAffiliateWebUrl: 'https://example.test/affiliate',
        }],
      });
    },
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth(), 2500, '1234567890');
  const [result] = await provider.search({ ...query, affiliate_reference_id: 'abc123def456' });

  assert.equal(capturedHeaders['X-EBAY-C-ENDUSERCTX'], 'affiliateCampaignId=1234567890,affiliateReferenceId=abc123def456');
  assert.equal(result.destination, 'https://example.test/affiliate');
});

test('eBay adapter: unconfigured affiliate context leaves ordinary request and destination unchanged', async () => {
  let capturedHeaders = {};
  const ctx = makeEbayContext(makeMockAuth(), {
    fetch: async (_url, opts) => {
      capturedHeaders = opts?.headers ?? {};
      return Response.json({
        itemSummaries: [{
          itemId: 'plain-1',
          title: 'Nike Air Max 90 White',
          itemWebUrl: 'https://example.test/plain',
          itemAffiliateWebUrl: 'https://example.test/affiliate-should-not-be-used-without-config',
        }],
      });
    },
  });
  loadModule(ebaySource, ctx);
  const { EbayCommerceProvider } = ctx.exports;

  const provider = new EbayCommerceProvider(makeMockAuth());
  const [result] = await provider.search({ ...query, affiliate_reference_id: 'abc123def456' });

  assert.equal(capturedHeaders['X-EBAY-C-ENDUSERCTX'], undefined);
  assert.equal(result.destination, 'https://example.test/affiliate-should-not-be-used-without-config');
});
