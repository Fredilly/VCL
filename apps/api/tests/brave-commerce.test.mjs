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

const credentialsSource = await readFile(new URL('../src/brave-credentials.ts', import.meta.url), 'utf8');
const commerceSource = await readFile(new URL('../src/commerce.ts', import.meta.url), 'utf8');
const braveSource = await readFile(new URL('../src/brave-commerce.ts', import.meta.url), 'utf8');

const commerceContext = vm.createContext({ exports: {} });
vm.runInContext(compile(stripImports(commerceSource)), commerceContext);
const { CommerceNoResultsError, CommerceProviderError } = commerceContext.exports;

function makeBraveContext(overrides = {}) {
  return vm.createContext({
    exports: {},
    CommerceNoResultsError,
    CommerceProviderError,
    crypto: { randomUUID: () => 'generated-id' },
    URL,
    AbortSignal,
    fetch: overrides.fetch ?? (async () => Response.json({
      type: 'search',
      query: { original: 'test query' },
      web: {
        type: 'search',
        results: [
          {
            title: 'Nike Air Max 90 - Buy Online',
            url: 'https://www.example.com/nike-air-max-90',
            description: 'Shop Nike Air Max 90 sneakers at great prices.',
            meta_url: {
              scheme: 'https',
              netloc: 'www.example.com',
              hostname: 'www.example.com',
              path: '/nike-air-max-90',
            },
            profile: {
              name: 'Example Store',
              url: 'https://www.example.com',
              long_name: 'example.com',
            },
          },
        ],
      },
    })),
    Date,
    console,
    ...overrides,
  });
}

const query = { query: 'Nike Air Max 90', category: 'shoes', subcategory: 'sneakers', brand: 'Nike', model: 'Air Max 90', attributes: [] };
const genericQuery = { query: 'silver ring', category: 'jewelry', subcategory: 'rings', brand: null, model: null, attributes: [] };
const apiKey = 'test-brave-api-key';

// ── Credentials tests ──

test('credentials: resolveBraveCredentials returns credentials when env var present', () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveBraveCredentials({ BRAVE_SEARCH_API_KEY: 'brave-key' });
  assert.ok(creds, 'should return credentials');
  assert.equal(creds.apiKey, 'brave-key');
});

test('credentials: resolveBraveCredentials returns null when key missing', () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveBraveCredentials({});
  assert.equal(creds, null);
});

test('credentials: resolveBraveCredentials returns null for whitespace-only key', () => {
  const ctx = vm.createContext({ exports: {} });
  loadModule(credentialsSource, ctx);
  const creds = ctx.exports.resolveBraveCredentials({ BRAVE_SEARCH_API_KEY: '   ' });
  assert.equal(creds, null);
});

// ── Normalization tests ──

test('adapter: normalizes candidates and never emits EXACT', async () => {
  const ctx = makeBraveContext();
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [candidate] = await provider.search(query);
  assert.equal(candidate.title, 'Nike Air Max 90 - Buy Online');
  assert.equal(candidate.result_class, 'SIMILAR');
  assert.notEqual(candidate.result_class, 'EXACT');
  assert.equal(candidate.provenance, 'brave:web-search');
  assert.equal(candidate.provider, 'brave');
});

test('adapter: result_class is always SIMILAR even with brand and model match', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'Nike Air Max 90' },
      web: {
        type: 'search',
        results: [{
          title: 'Nike Air Max 90 Original Shoes',
          url: 'https://www.nike.com/air-max-90',
          description: 'The original Nike Air Max 90.',
          meta_url: { hostname: 'www.nike.com' },
        }],
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [result] = await provider.search(query);
  assert.equal(result.result_class, 'SIMILAR', 'Brave results must always default to SIMILAR');
  assert.notEqual(result.result_class, 'EXACT');
});

test('adapter: preserves destination URL from search result', async () => {
  const ctx = makeBraveContext();
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [candidate] = await provider.search(query);
  assert.equal(candidate.destination, 'https://www.example.com/nike-air-max-90');
});

test('adapter: extracts domain into metadata.category', async () => {
  const ctx = makeBraveContext();
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [candidate] = await provider.search(query);
  assert.equal(candidate.metadata.category, 'example.com');
});

test('adapter: strips HTML from description', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: {
        type: 'search',
        results: [{
          title: 'Item',
          url: 'https://www.example.com/item',
          description: '<strong>Bold</strong> item with <em>tags</em>.',
        }],
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [result] = await provider.search(query);
  assert.equal(result.metadata.description, 'Bold item with tags.');
});

test('adapter: truncates description to 800 chars', async () => {
  const longDesc = 'A'.repeat(1000);
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: {
        type: 'search',
        results: [{
          title: 'Item',
          url: 'https://www.example.com/item',
          description: longDesc,
        }],
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [result] = await provider.search(query);
  assert.equal(result.metadata.description.length, 800);
});

test('adapter: items without title are filtered out', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: {
        type: 'search',
        results: [
          { url: 'https://www.example.com/no-title', description: 'No title here' },
          { title: 'Valid Item', url: 'https://www.example.com/valid' },
        ],
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const results = await provider.search(query);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Valid Item');
});

test('adapter: never invents price, brand, or model', async () => {
  const ctx = makeBraveContext();
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [candidate] = await provider.search(query);
  assert.equal(candidate.price, null);
  assert.equal(candidate.currency, null);
  assert.equal(candidate.brand, null);
  assert.equal(candidate.model, null);
});

test('adapter: id is a UUID', async () => {
  const ctx = makeBraveContext();
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [candidate] = await provider.search(query);
  assert.equal(typeof candidate.id, 'string');
  assert.ok(candidate.id.length > 0);
});

test('adapter: image_reference is null (Brave does not provide product images)', async () => {
  const ctx = makeBraveContext();
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [candidate] = await provider.search(query);
  assert.equal(candidate.image_reference, null);
});

test('adapter: caps at 12 results', async () => {
  const items = Array.from({ length: 15 }, (_, i) => ({
    title: `Result ${i}`,
    url: `https://www.example.com/item-${i}`,
    description: `Item ${i} description`,
  }));
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: { type: 'search', results: items },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const results = await provider.search(query);
  assert.equal(results.length, 12);
});

// ── Failure state tests ──

test('no results: empty results throws CommerceNoResultsError', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: { type: 'search', results: [] },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'NO_RESULTS');
    return true;
  });
});

test('no results: missing web field throws CommerceNoResultsError', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'NO_RESULTS');
    return true;
  });
});

test('no results: all results without titles throws CommerceNoResultsError', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: {
        type: 'search',
        results: [
          { url: 'https://example.com', description: 'no title' },
        ],
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'NO_RESULTS');
    return true;
  });
});

test('rate limited: 429 throws CommerceProviderError', async () => {
  const ctx = makeBraveContext({
    fetch: async () => new Response('Too Many Requests', { status: 429, statusText: 'Too Many Requests' }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /429/);
    return true;
  });
});

test('provider error: HTTP 500 throws CommerceProviderError', async () => {
  const ctx = makeBraveContext({
    fetch: async () => new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /500/);
    return true;
  });
});

test('provider error: HTTP 403 throws CommerceProviderError', async () => {
  const ctx = makeBraveContext({
    fetch: async () => new Response('Forbidden', { status: 403, statusText: 'Forbidden' }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /403/);
    return true;
  });
});

test('malformed response: invalid JSON throws CommerceProviderError', async () => {
  const ctx = makeBraveContext({
    fetch: async () => new Response('not json at all', { status: 200 }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /invalid JSON/);
    return true;
  });
});

test('network error: throws CommerceProviderError', async () => {
  const ctx = makeBraveContext({
    fetch: async () => { throw new TypeError('fetch failed'); },
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    return true;
  });
});

test('timeout: throws CommerceProviderError', async () => {
  const ctx = makeBraveContext({
    fetch: async () => { throw new Error('The operation was aborted'); },
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    return true;
  });
});

// ── Quota metadata tests ──

test('quota info: captures rate limit headers from response', async () => {
  const ctx = makeBraveContext({
    fetch: async () => {
      const response = Response.json({
        type: 'search',
        query: { original: 'test' },
        web: { type: 'search', results: [{ title: 'Test', url: 'https://example.com' }] },
      });
      response.headers.set('x-ratelimit-remaining', '45');
      response.headers.set('x-ratelimit-limit', '50');
      return response;
    },
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  await provider.search(query);
  const quota = provider.getQuotaInfo();
  assert.equal(quota.tokens_remaining, 45);
  assert.equal(quota.tokens_limit, 50);
});

test('quota info: handles missing headers gracefully', async () => {
  const ctx = makeBraveContext();
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  await provider.search(query);
  const quota = provider.getQuotaInfo();
  assert.equal(quota.tokens_remaining, undefined);
  assert.equal(quota.tokens_limit, undefined);
});

// ── API request verification tests ──

test('adapter: sends X-Subscription-Token header', async () => {
  let capturedHeaders = {};
  const ctx = makeBraveContext({
    fetch: async (url, opts) => {
      capturedHeaders = opts?.headers ?? {};
      return Response.json({
        type: 'search',
        query: { original: 'test' },
        web: { type: 'search', results: [] },
      });
    },
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  try { await provider.search(query); } catch {}
  assert.equal(capturedHeaders['X-Subscription-Token'], apiKey);
});

test('adapter: sends Accept: application/json header', async () => {
  let capturedHeaders = {};
  const ctx = makeBraveContext({
    fetch: async (url, opts) => {
      capturedHeaders = opts?.headers ?? {};
      return Response.json({
        type: 'search',
        query: { original: 'test' },
        web: { type: 'search', results: [] },
      });
    },
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  try { await provider.search(query); } catch {}
  assert.equal(capturedHeaders['Accept'], 'application/json');
});

test('adapter: request URL includes query, count, country, and search_lang', async () => {
  let capturedUrl = '';
  const ctx = makeBraveContext({
    fetch: async (url) => {
      capturedUrl = String(url);
      return Response.json({
        type: 'search',
        query: { original: 'test' },
        web: { type: 'search', results: [] },
      });
    },
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  try { await provider.search(query); } catch {}
  assert.ok(capturedUrl.includes('q='), 'should include query parameter');
  assert.ok(capturedUrl.includes('count=12'), 'should include count=12');
  assert.ok(capturedUrl.includes('country=us'), 'should include country=us');
  assert.ok(capturedUrl.includes('search_lang=en'), 'should include search_lang=en');
});

test('adapter: request uses Brave web search endpoint', async () => {
  let capturedUrl = '';
  const ctx = makeBraveContext({
    fetch: async (url) => {
      capturedUrl = String(url);
      return Response.json({
        type: 'search',
        query: { original: 'test' },
        web: { type: 'search', results: [] },
      });
    },
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  try { await provider.search(query); } catch {}
  assert.ok(capturedUrl.startsWith('https://api.search.brave.com/res/v1/web/search'), 'should use Brave web search endpoint');
});

// ── Provenance and destination tests ──

test('adapter: provenance is brave:web-search', async () => {
  const ctx = makeBraveContext();
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [candidate] = await provider.search(query);
  assert.equal(candidate.provenance, 'brave:web-search');
});

test('adapter: provider is brave', async () => {
  const ctx = makeBraveContext();
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [candidate] = await provider.search(query);
  assert.equal(candidate.provider, 'brave');
});

test('adapter: destination preserves full URL', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: {
        type: 'search',
        results: [{
          title: 'Item',
          url: 'https://www.some-store.com/products/item?ref=search',
          description: 'A product page',
        }],
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [candidate] = await provider.search(query);
  assert.equal(candidate.destination, 'https://www.some-store.com/products/item?ref=search');
});

test('adapter: handles missing url in result', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: {
        type: 'search',
        results: [{
          title: 'Item Without URL',
          description: 'No URL here',
        }],
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [result] = await provider.search(query);
  assert.equal(result.destination, null);
});

test('adapter: handles missing description gracefully', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: {
        type: 'search',
        results: [{
          title: 'Item Without Description',
          url: 'https://www.example.com/item',
        }],
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [result] = await provider.search(query);
  assert.equal(result.metadata.description, undefined);
});

// ── Conservative classification tests ──

test('adapter: does not upgrade to LIKELY from title match alone', async () => {
  const brandQuery = { query: 'Nike Air Max', category: 'shoes', subcategory: 'sneakers', brand: 'Nike', model: 'Air Max', attributes: [] };
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'Nike Air Max' },
      web: {
        type: 'search',
        results: [{
          title: 'Nike Air Max 90 Sneakers - Official Store',
          url: 'https://www.nike.com/air-max-90',
          description: 'Buy Nike Air Max 90.',
        }],
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [result] = await provider.search(brandQuery);
  assert.equal(result.result_class, 'SIMILAR', 'Brave must not upgrade to LIKELY from search rank or title match');
});

test('adapter: all candidates default to SIMILAR', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: {
        type: 'search',
        results: [
          { title: 'Result 1', url: 'https://a.com/1' },
          { title: 'Result 2', url: 'https://b.com/2' },
          { title: 'Result 3', url: 'https://c.com/3' },
        ],
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const results = await provider.search(query);
  for (const result of results) {
    assert.equal(result.result_class, 'SIMILAR');
  }
});

// ── Error never fails resolver test ──

test('adapter: throws typed errors that resolver can catch', async () => {
  const ctx = makeBraveContext({
    fetch: async () => new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  try {
    await provider.search(query);
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof CommerceProviderError, 'should throw CommerceProviderError');
    assert.equal(error.code, 'COMMERCE_PROVIDER_ERROR');
  }
});

// ── Multiple results normalization ──

test('adapter: normalizes multiple results correctly', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: {
        type: 'search',
        results: [
          {
            title: 'Product A',
            url: 'https://store-a.com/product-a',
            description: 'Great product A',
            meta_url: { hostname: 'store-a.com' },
          },
          {
            title: 'Product B',
            url: 'https://store-b.com/product-b',
            description: 'Great product B',
            meta_url: { hostname: 'store-b.com' },
          },
        ],
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const results = await provider.search(query);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'Product A');
  assert.equal(results[0].destination, 'https://store-a.com/product-a');
  assert.equal(results[0].metadata.category, 'store-a.com');
  assert.equal(results[1].title, 'Product B');
  assert.equal(results[1].destination, 'https://store-b.com/product-b');
  assert.equal(results[1].metadata.category, 'store-b.com');
});

// ── Infobox/mixed results are ignored (only web results used) ──

test('adapter: ignores infobox and only uses web results', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: {
        type: 'search',
        results: [{ title: 'Web Result', url: 'https://example.com/web' }],
      },
      infobox: {
        type: 'infobox',
        title: 'Infobox Title',
        url: 'https://example.com/infobox',
        description: 'Infobox description',
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const results = await provider.search(query);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Web Result');
});

// ── Domain extraction edge cases ──

test('adapter: extracts domain from URL when meta_url missing', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: {
        type: 'search',
        results: [{
          title: 'Item',
          url: 'https://www.my-shop.com/products/item',
          description: 'A product',
        }],
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [result] = await provider.search(query);
  assert.equal(result.metadata.category, 'my-shop.com');
});

test('adapter: handles invalid URL for domain extraction', async () => {
  const ctx = makeBraveContext({
    fetch: async () => Response.json({
      type: 'search',
      query: { original: 'test' },
      web: {
        type: 'search',
        results: [{
          title: 'Item',
          url: 'not-a-valid-url',
          description: 'A product',
        }],
      },
    }),
  });
  loadModule(braveSource, ctx);
  const { BraveCommerceProvider } = ctx.exports;

  const provider = new BraveCommerceProvider(apiKey);
  const [result] = await provider.search(query);
  assert.equal(result.metadata.category, undefined);
});
