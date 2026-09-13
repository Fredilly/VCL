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

const commerceSource = await readFile(new URL('../src/commerce.ts', import.meta.url), 'utf8');
const serpapiSource = await readFile(new URL('../src/serpapi-commerce.ts', import.meta.url), 'utf8');

const commerceContext = vm.createContext({ exports: {} });
vm.runInContext(compile(stripImports(commerceSource)), commerceContext);
const { CommerceNoResultsError, CommerceProviderError } = commerceContext.exports;

const accountResponse = {
  account_id: 'test-id',
  api_key: 'test-key',
  account_email: 'test@example.com',
  account_status: 'Active',
  plan_id: 'starter',
  plan_name: 'Starter Plan',
  plan_monthly_price: 25,
  plan_renewal_date: '2026-10-01',
  searches_per_month: 1000,
  plan_searches_left: 500,
  extra_credits: 0,
  total_searches_left: 500,
  this_month_usage: 500,
  this_hour_searches: 5,
  last_hour_searches: 3,
  account_rate_limit_per_hour: 200,
};

function makeSerpapiContext(overrides = {}) {
  return vm.createContext({
    exports: {},
    CommerceNoResultsError,
    CommerceProviderError,
    crypto: { randomUUID: () => 'generated-id' },
    URL,
    AbortSignal,
    fetch: overrides.fetch ?? (async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json(accountResponse);
      return Response.json({
        shopping_results: [
          { product_id: '1', title: 'Nike Air Max 90', product_link: 'https://example.com/1', source: 'Nike', price: '$120.00', extracted_price: 120, thumbnail: 'https://img.example.com/1.jpg', snippet: 'Classic sneakers' },
          { product_id: '2', title: 'Adidas Ultraboost', product_link: 'https://example.com/2', source: 'Adidas', price: '$180.00', extracted_price: 180, thumbnail: 'https://img.example.com/2.jpg', snippet: 'Running shoes' },
        ],
      });
    }),
    Date,
    console,
    ...overrides,
  });
}

const query = { query: 'Nike Air Max 90', category: 'shoes', subcategory: 'sneakers', brand: 'Nike', model: 'Air Max 90', attributes: [] };
const genericQuery = { query: 'silver ring', category: 'jewelry', subcategory: 'rings', brand: null, model: null, attributes: [] };
const apiKey = 'test-serpapi-key';

// ── Normalization tests ──

test('adapter: normalizes candidates from SerpAPI shopping results', async () => {
  const ctx = makeSerpapiContext();
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  const results = await provider.search(query);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'Nike Air Max 90');
  assert.equal(results[0].provider, 'serpapi');
  assert.equal(results[0].provenance, 'serpapi:google-shopping:Nike');
  assert.equal(results[0].destination, 'https://example.com/1');
  assert.equal(results[0].price, '120');
  assert.equal(results[0].currency, 'USD');
  assert.equal(results[0].image_reference, 'https://img.example.com/1.jpg');
});

test('adapter: result_class is LIKELY when brand and model match title', async () => {
  const ctx = makeSerpapiContext();
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  const results = await provider.search(query);
  assert.equal(results[0].result_class, 'LIKELY');
});

test('adapter: result_class is SIMILAR when brand/model do not match', async () => {
  const ctx = makeSerpapiContext();
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  const results = await provider.search(query);
  assert.equal(results[1].result_class, 'SIMILAR');
});

test('adapter: result_class is SIMILAR when query has no brand/model', async () => {
  const ctx = makeSerpapiContext();
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  const results = await provider.search(genericQuery);
  for (const r of results) {
    assert.equal(r.result_class, 'SIMILAR');
  }
});

test('adapter: caps results at 12', async () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    product_id: String(i), title: `Item ${i}`, product_link: `https://example.com/${i}`, source: 'Store', price: '$10', extracted_price: 10,
  }));
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json(accountResponse);
      return Response.json({ shopping_results: items });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  const results = await provider.search(query);
  assert.equal(results.length, 12);
});

test('adapter: items without title are filtered out', async () => {
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json(accountResponse);
      return Response.json({
        shopping_results: [
          { product_id: '1', product_link: 'https://example.com/1' },
          { product_id: '2', title: 'Valid Item', product_link: 'https://example.com/2' },
        ],
      });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  const results = await provider.search(query);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Valid Item');
});

test('adapter: provenance falls back to serpapi:google-shopping when source missing', async () => {
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json(accountResponse);
      return Response.json({
        shopping_results: [{ product_id: '1', title: 'Item', product_link: 'https://example.com/1' }],
      });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  const results = await provider.search(query);
  assert.equal(results[0].provenance, 'serpapi:google-shopping');
});

test('adapter: never invents brand or model', async () => {
  const ctx = makeSerpapiContext();
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  const results = await provider.search(query);
  for (const r of results) {
    assert.equal(r.brand, null);
    assert.equal(r.model, null);
  }
});

// ── Error handling tests ──

test('no results: throws CommerceNoResultsError', async () => {
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json(accountResponse);
      return Response.json({ shopping_results: [] });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'NO_RESULTS');
    return true;
  });
});

test('no results message: throws CommerceNoResultsError', async () => {
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json(accountResponse);
      return Response.json({ error: "Google hasn't returned any results for this query." });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'NO_RESULTS');
    return true;
  });
});

test('HTTP 500: throws CommerceProviderError', async () => {
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json(accountResponse);
      return new Response('Internal Server Error', { status: 500 });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /500/);
    return true;
  });
});

test('HTTP 403: throws CommerceProviderError', async () => {
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json(accountResponse);
      return new Response('Forbidden', { status: 403 });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /403/);
    return true;
  });
});

test('invalid JSON: throws CommerceProviderError', async () => {
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json(accountResponse);
      return new Response('not json', { status: 200 });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /invalid JSON/);
    return true;
  });
});

test('network error: throws CommerceProviderError', async () => {
  const ctx = makeSerpapiContext({
    fetch: async () => { throw new TypeError('fetch failed'); },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    return true;
  });
});

test('timeout: throws CommerceProviderError', async () => {
  const ctx = makeSerpapiContext({
    fetch: async () => { throw new Error('The operation was aborted'); },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    return true;
  });
});

// ── Quota protection tests ──

test('quota exhausted: HTTP 429 marks quota as exhausted', async () => {
  let fetchCount = 0;
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json(accountResponse);
      fetchCount++;
      return new Response('Too Many Requests', { status: 429 });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /429/);
    return true;
  });
  assert.equal(provider.isQuotaExhausted(), true);

  // Subsequent calls should be skipped without hitting the API.
  fetchCount = 0;
  await assert.rejects(() => provider.search(query), (err) => {
    assert.match(err.message, /quota exhausted/);
    return true;
  });
  assert.equal(fetchCount, 0, 'should not call fetch after quota exhaustion');
});

test('quota exhausted: error message from SerpAPI marks quota as exhausted', async () => {
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json(accountResponse);
      return Response.json({ error: 'Your account has run out of searches.' });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /quota exhausted/);
    return true;
  });
  assert.equal(provider.isQuotaExhausted(), true);
});

test('quota exhausted: rate limit exceeded message marks quota as exhausted', async () => {
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json(accountResponse);
      return Response.json({ error: 'You have exceeded the hourly throughput limit.' });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.match(err.message, /quota exhausted/);
    return true;
  });
  assert.equal(provider.isQuotaExhausted(), true);
});

test('quota metadata: captures account info from Account API', async () => {
  const ctx = makeSerpapiContext();
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await provider.search(query);
  const quota = provider.getQuotaInfo();
  assert.equal(quota.plan_searches_left, 500);
  assert.equal(quota.total_searches_left, 500);
  assert.equal(quota.this_month_usage, 500);
  assert.equal(quota.searches_per_month, 1000);
  assert.equal(quota.account_rate_limit_per_hour, 200);
  assert.equal(quota.this_hour_searches, 5);
});

test('quota metadata: handles missing Account API gracefully', async () => {
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return new Response('error', { status: 500 });
      return Response.json({
        shopping_results: [{ product_id: '1', title: 'Item', product_link: 'https://example.com/1' }],
      });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  const results = await provider.search(query);
  assert.equal(results.length, 1);
  const quota = provider.getQuotaInfo();
  assert.equal(quota.plan_searches_left, undefined);
});

test('quota metadata: Account API with zero remaining marks exhausted', async () => {
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json({ ...accountResponse, plan_searches_left: 0, total_searches_left: 0 });
      return Response.json({ shopping_results: [{ product_id: '1', title: 'Item' }] });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await assert.rejects(() => provider.search(query), (err) => {
    assert.match(err.message, /quota exhausted/);
    return true;
  });
  assert.equal(provider.isQuotaExhausted(), true);
});

test('quota metadata: does not fetch Account API twice', async () => {
  let accountFetchCount = 0;
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) { accountFetchCount++; return Response.json(accountResponse); }
      return Response.json({ shopping_results: [{ product_id: '1', title: 'Item', product_link: 'https://example.com/1' }] });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await provider.search(query);
  await provider.search(query);
  assert.equal(accountFetchCount, 1, 'Account API should only be called once');
});

// ── No raw provider error exposed ──

test('no raw provider error exposed to caller', async () => {
  const ctx = makeSerpapiContext({
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('account.json')) return Response.json(accountResponse);
      return new Response('SerpAPI Internal Error: stack trace here\nat ...', { status: 500 });
    },
  });
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  try {
    await provider.search(query);
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 'COMMERCE_PROVIDER_ERROR');
    assert.ok(!err.message.includes('stack trace'), 'should not expose raw provider error');
    assert.ok(!err.message.includes('SerpAPI Internal Error'), 'should not expose raw provider error');
  }
});

// ── Quota field contract ──

test('SerpApiQuotaInfo type has expected fields', async () => {
  const ctx = makeSerpapiContext();
  loadModule(serpapiSource, ctx);
  const { SerpApiCommerceProvider } = ctx.exports;

  const provider = new SerpApiCommerceProvider(apiKey);
  await provider.search(query);
  const quota = provider.getQuotaInfo();
  const expectedFields = ['plan_searches_left', 'total_searches_left', 'this_month_usage', 'searches_per_month', 'account_rate_limit_per_hour', 'this_hour_searches'];
  for (const field of expectedFields) {
    assert.ok(field in quota, `quota info should have ${field} field`);
  }
});
