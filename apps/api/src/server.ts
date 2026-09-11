import { GeminiVisionProvider } from './gemini-vision.js';
import { GroqVisionProvider } from './groq-vision.js';
import { normalizeObjectDescription } from './types.js';
import {
  CommerceNoResultsError,
  buildProductQueryVariants,
  type CommerceProvider,
  type ProductCandidate,
  type ProductQuery,
} from './commerce.js';
import { EbayCommerceProvider } from './ebay-commerce.js';
import { SerpApiCommerceProvider } from './serpapi-commerce.js';

export interface Env {
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  VISION_PROVIDER?: string;
  GEMINI_MODEL?: string;
  EBAY_ACCESS_TOKEN?: string;
  SERPAPI_API_KEY?: string;
  COMMERCE_PROVIDER?: string;
}

type NamedCommerceProvider = {
  name: string;
  provider: CommerceProvider;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function logSafeError(error: unknown): void {
  console.error('VCL API error', error instanceof Error ? { name: error.name, message: error.message } : { name: typeof error, message: String(error) });
}

function commerceProviders(env: Env): NamedCommerceProvider[] {
  const serpapi: NamedCommerceProvider | null = env.SERPAPI_API_KEY
    ? { name: 'serpapi', provider: new SerpApiCommerceProvider(env.SERPAPI_API_KEY) }
    : null;
  const ebay: NamedCommerceProvider | null = env.EBAY_ACCESS_TOKEN
    ? { name: 'ebay', provider: new EbayCommerceProvider(env.EBAY_ACCESS_TOKEN) }
    : null;

  if (env.COMMERCE_PROVIDER === 'serpapi') return serpapi ? [serpapi] : [];
  if (env.COMMERCE_PROVIDER === 'ebay') return ebay ? [ebay] : [];

  return [serpapi, ebay].filter((entry): entry is NamedCommerceProvider => Boolean(entry));
}

function dedupeProducts(products: ProductCandidate[]): ProductCandidate[] {
  const seen = new Set<string>();
  const deduped: ProductCandidate[] = [];

  for (const product of products) {
    const key = product.destination || `${product.provenance}:${product.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(product);
    if (deduped.length >= 8) break;
  }

  return deduped;
}

async function resolveProducts(
  providers: NamedCommerceProvider[],
  queries: ProductQuery[],
): Promise<{
  query: ProductQuery;
  products: ProductCandidate[];
  state: 'RESULTS' | 'NO_RESULTS' | 'TEMPORARILY_UNAVAILABLE';
  providers_used: string[];
  attempts: number;
}> {
  let attempts = 0;
  let sawProviderFailure = false;
  let activeProviders = [...providers];
  const providersUsed = new Set<string>();

  for (const query of queries) {
    if (activeProviders.length === 0) break;

    attempts += 1;
    const providersForAttempt = [...activeProviders];
    const settled = await Promise.allSettled(providersForAttempt.map(async ({ name, provider }) => {
      providersUsed.add(name);
      return provider.search(query);
    }));

    const products: ProductCandidate[] = [];
    const failedProviders = new Set<string>();

    settled.forEach((result, index) => {
      const providerName = providersForAttempt[index].name;
      if (result.status === 'fulfilled') {
        products.push(...result.value);
        return;
      }

      if (result.reason instanceof CommerceNoResultsError) return;

      sawProviderFailure = true;
      failedProviders.add(providerName);
      logSafeError(result.reason);
    });

    if (failedProviders.size > 0) {
      activeProviders = activeProviders.filter(({ name }) => !failedProviders.has(name));
    }

    const deduped = dedupeProducts(products);
    if (deduped.length > 0) {
      return {
        query,
        products: deduped,
        state: 'RESULTS',
        providers_used: [...providersUsed],
        attempts,
      };
    }

    if (activeProviders.length === 0 && sawProviderFailure) {
      return {
        query,
        products: [],
        state: 'TEMPORARILY_UNAVAILABLE',
        providers_used: [...providersUsed],
        attempts,
      };
    }
  }

  return {
    query: queries[Math.max(0, Math.min(attempts - 1, queries.length - 1))],
    products: [],
    state: sawProviderFailure ? 'TEMPORARILY_UNAVAILABLE' : 'NO_RESULTS',
    providers_used: [...providersUsed],
    attempts,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);
    if (request.method !== 'POST') return jsonResponse({ error: 'Not found' }, 404);

    try {
      if (url.pathname === '/analyze-selection') {
        const parsed: unknown = await request.json();
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return jsonResponse({ error: 'dataUrl image is required' }, 400);
        const dataUrl = (parsed as { dataUrl?: unknown }).dataUrl;
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return jsonResponse({ error: 'dataUrl image is required' }, 400);
        const useGemini = env.VISION_PROVIDER === 'gemini';
        const apiKey = useGemini ? env.GEMINI_API_KEY : env.GROQ_API_KEY;
        if (!apiKey) return jsonResponse({ error: `Missing ${useGemini ? 'GEMINI_API_KEY' : 'GROQ_API_KEY'}` }, 500);
        const provider = useGemini ? new GeminiVisionProvider(apiKey, env.GEMINI_MODEL) : new GroqVisionProvider(apiKey);
        return jsonResponse(normalizeObjectDescription(await provider.analyzeSelection(dataUrl)));
      }

      if (url.pathname === '/resolve-products') {
        const description = normalizeObjectDescription(await request.json());
        const providers = commerceProviders(env);
        if (providers.length === 0) return jsonResponse({ error: 'No configured commerce provider' }, 503);

        const queries = buildProductQueryVariants(description);
        const started = Date.now();
        const resolved = await resolveProducts(providers, queries);
        return jsonResponse({
          ...resolved,
          latency_ms: Date.now() - started,
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      logSafeError(error);
      return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown API error' }, 500);
    }
  },
};
