import { GeminiVisionProvider } from './gemini-vision.js';
import { GroqVisionProvider } from './groq-vision.js';
import { normalizeObjectDescription } from './types.js';
import {
  CommerceNoResultsError,
  buildProductQueryVariants,
  verifyProductCandidate,
  type CommerceProvider,
  type ProductCandidate,
  type ProductContext,
  type ProductQuery,
} from './commerce.js';
import { applyAttributeInvariantGate } from './attribute-gate.js';
import { applyBrandGate } from './brand-gate.js';
import { EbayCommerceProvider } from './ebay-commerce.js';
import { EbayAuth } from './ebay-auth.js';
import { resolveEbayCredentials, type EbayCredentials } from './ebay-credentials.js';
import { SerpApiCommerceProvider } from './serpapi-commerce.js';

export interface Env {
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  VISION_PROVIDER?: string;
  GEMINI_MODEL?: string;
  EBAY_SANDBOX_CLIENT_ID?: string;
  EBAY_SANDBOX_CLIENT_SECRET?: string;
  EBAY_PRODUCTION_CLIENT_ID?: string;
  EBAY_PRODUCTION_CLIENT_SECRET?: string;
  EBAY_DEV_ID?: string;
  EBAY_ENVIRONMENT?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_SANDBOX?: string;
  SERPAPI_API_KEY?: string;
  COMMERCE_PROVIDER?: string;
}

type NamedCommerceProvider = {
  name: string;
  provider: CommerceProvider;
};

type Image = { mimeType: string; data: string };

type ImageComparisonResult = {
  candidate: Record<string, unknown>;
  similarity?: number;
};

type ImageVerifier = (
  apiKey: string | undefined,
  model: string | undefined,
  source: Image,
  description: ReturnType<typeof normalizeObjectDescription>,
  products: ProductCandidate[],
) => Promise<{
  comparisons: Map<string, ImageComparisonResult>;
  compared: number;
  failures: number;
}>;

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

function normalizeContext(value: unknown): ProductContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  return {
    platform: typeof v.platform === 'string' ? v.platform.slice(0, 40) : null,
    title: typeof v.title === 'string' ? v.title.slice(0, 300) : null,
  };
}

function makeEbayAuth(creds: EbayCredentials): EbayAuth {
  return new EbayAuth({ clientId: creds.clientId, clientSecret: creds.clientSecret, sandbox: creds.sandbox });
}

function commerceProviders(env: Env): NamedCommerceProvider[] {
  const serpapi: NamedCommerceProvider | null = env.SERPAPI_API_KEY
    ? { name: 'serpapi', provider: new SerpApiCommerceProvider(env.SERPAPI_API_KEY) }
    : null;

  let ebay: NamedCommerceProvider | null = null;
  const ebayCreds = resolveEbayCredentials(env);
  if (ebayCreds) {
    ebay = { name: 'ebay', provider: new EbayCommerceProvider(makeEbayAuth(ebayCreds)) };
  }

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

export async function resolveProducts(
  providers: NamedCommerceProvider[],
  queries: ProductQuery[],
  description?: ReturnType<typeof normalizeObjectDescription>,
  env?: Env,
  context?: ProductContext,
  source?: Image,
  verifier?: ImageVerifier,
): Promise<{
  query: ProductQuery;
  products: ProductCandidate[];
  state: 'RESULTS' | 'NO_RESULTS' | 'TEMPORARILY_UNAVAILABLE';
  providers_used: string[];
  attempts: number;
  verification?: {
    rejected: number;
    compared: number;
    failures: number;
    image_failures: number;
  };
}> {
  let attempts = 0;
  let sawProviderFailure = false;
  let activeProviders = [...providers];
  const providersUsed = new Set<string>();
  let totalRejected = 0;
  const allRawProducts: ProductCandidate[] = [];

  for (const query of queries) {
    if (activeProviders.length === 0) break;

    attempts += 1;
    const providersForAttempt = [...activeProviders];
    const settled = await Promise.allSettled(providersForAttempt.map(async ({ name, provider }) => {
      providersUsed.add(name);
      return provider.search(query);
    }));

    const failedProviders = new Set<string>();

    settled.forEach((result, index) => {
      const providerName = providersForAttempt[index].name;
      if (result.status === 'fulfilled') {
        allRawProducts.push(...result.value);
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
  }

  if (!description) {
    const deduped = dedupeProducts(allRawProducts);
    if (deduped.length > 0) {
      return {
        query: queries[Math.max(0, Math.min(attempts - 1, queries.length - 1))],
        products: deduped,
        state: 'RESULTS',
        providers_used: [...providersUsed],
        attempts,
      };
    }
  } else if (allRawProducts.length > 0) {
    const verified = allRawProducts
      .map((product) => {
        const result = verifyProductCandidate(description, product, context);
        if (!result) totalRejected++;
        return result;
      })
      .filter((product): product is ProductCandidate => Boolean(product))
      .sort((a, b) => (b.verification_score ?? 0) - (a.verification_score ?? 0));

    const invariantVerified = applyAttributeInvariantGate(description, verified, context);
    const brandVerified = applyBrandGate(description, invariantVerified);

    if (verifier && source && env) {
      const seen = new Set<string>();
      const unique = brandVerified.filter((product) => {
        const key = JSON.stringify([product.provenance, product.id, product.title, product.image_reference, product.metadata]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      let compared = 0;
      let imageFailures = 0;

      try {
        const verification = await verifier(env.GEMINI_API_KEY, env.GEMINI_MODEL, source, description, unique);
        compared = verification.compared;
        imageFailures = verification.failures;

        const colorNormalized = (c: string) => c.toLowerCase().replace(/grey/g, 'gray').replace(/[^a-z]+/g, '').trim();
        const descColor = description.color ? colorNormalized(description.color) : null;

        const ranked: ProductCandidate[] = [];
        for (const product of unique) {
          const key = JSON.stringify([product.provenance, product.id, product.title, product.image_reference, product.metadata]);
          const comparison = verification.comparisons.get(key);
          if (!comparison) {
            ranked.push({ ...product, result_class: 'SIMILAR' as const, verification_status: 'metadata_only' as const });
            continue;
          }

          const candidateColorObs = (comparison.candidate as Record<string, unknown>)?.color as { value?: string | null } | undefined;
          if (candidateColorObs?.value && descColor) {
            if (colorNormalized(String(candidateColorObs.value)) !== descColor) {
              continue;
            }
          }

          const updated: ProductCandidate = { ...product, verification_status: 'multimodal' as const };
          if (comparison.similarity != null) {
            updated.verification_image_similarity = comparison.similarity;
          }
          ranked.push(updated);
        }
        ranked.sort((a, b) => (b.verification_image_similarity ?? 0) - (a.verification_image_similarity ?? 0));

        const deduped = dedupeProducts(ranked);
        if (deduped.length) {
          return {
            query: queries[Math.max(0, Math.min(attempts - 1, queries.length - 1))],
            products: deduped,
            state: 'RESULTS' as const,
            providers_used: [...providersUsed],
            attempts,
            verification: { rejected: totalRejected, compared, failures: imageFailures, image_failures: imageFailures },
          };
        }
      } catch {
        imageFailures++;
      }

      return {
        query: queries[Math.max(0, Math.min(attempts - 1, queries.length - 1))],
        products: [],
        state: 'NO_RESULTS',
        providers_used: [...providersUsed],
        attempts,
        verification: { rejected: totalRejected, compared, failures: imageFailures, image_failures: imageFailures },
      };
    } else {
      const deduped = dedupeProducts(brandVerified);
      if (deduped.length) {
        return {
          query: queries[Math.max(0, Math.min(attempts - 1, queries.length - 1))],
          products: deduped,
          state: 'RESULTS' as const,
          providers_used: [...providersUsed],
          attempts,
          verification: { rejected: totalRejected, compared: 0, failures: 0, image_failures: 0 },
        };
      }
    }
  }

  return {
    query: queries[Math.max(0, Math.min(attempts - 1, queries.length - 1))],
    products: [],
    state: sawProviderFailure ? 'TEMPORARILY_UNAVAILABLE' : 'NO_RESULTS',
    providers_used: [...providersUsed],
    attempts,
    verification: description ? { rejected: totalRejected, compared: 0, failures: 0, image_failures: 0 } : undefined,
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
        const parsed: unknown = await request.json();
        const wrapped = Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'description' in parsed);
        const record = wrapped ? parsed as { description: unknown; context?: unknown } : { description: parsed, context: undefined };
        const description = normalizeObjectDescription(record.description);
        const context = normalizeContext(record.context);
        const providers = commerceProviders(env);
        if (providers.length === 0) return jsonResponse({ error: 'No configured commerce provider' }, 503);

        const queries = buildProductQueryVariants(description, context);
        const started = Date.now();
        const resolved = await resolveProducts(providers, queries, description, env, context);
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
