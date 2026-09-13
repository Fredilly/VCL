import { GeminiVisionProvider } from './gemini-vision.js';
import { GroqVisionProvider } from './groq-vision.js';
import { normalizeObjectDescription } from './types.js';
import { CommerceNoResultsError, buildProductQueryVariants, type CommerceProvider, type ProductCandidate, type ProductContext, type ProductQuery } from './commerce.js';
import { verifyCandidate, rankVerified } from './candidate-verification.js';
import { candidateKey, compareCandidateImages, parseSourceImage, imageRequestBudget } from './candidate-images.js';
import type { ImageComparison } from './verification-evidence.js';
import { EbayAuth } from './ebay-auth.js';
import { EbayCommerceProvider } from './ebay-commerce.js';
import { resolveEbayCredentials, type EbayCredentials } from './ebay-credentials.js';
import { EtsyCommerceProvider } from './etsy-commerce.js';
import { resolveEtsyCredentials, type EtsyCredentials } from './etsy-credentials.js';
import { SerpApiCommerceProvider } from './serpapi-commerce.js';
import { BraveCommerceProvider } from './brave-commerce.js';
import { resolveBraveCredentials } from './brave-credentials.js';

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
  ETSY_KEYSTRING?: string;
  ETSY_SHARED_SECRET?: string;
  BRAVE_SEARCH_API_KEY?: string;
}

type NamedCommerceProvider = { name: string; provider: CommerceProvider };
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
function logSafeError(error: unknown) { console.error('VCL API error', error instanceof Error ? { name: error.name, message: error.message } : { name: typeof error, message: String(error) }); }

function dedupeProducts(products: ProductCandidate[]) {
  const seen = new Set<string>(); const out: ProductCandidate[] = [];
  for (const product of products) { const key = product.destination || `${product.provenance}:${product.id}`; if (seen.has(key)) continue; seen.add(key); out.push(product); if (out.length >= 8) break; }
  return out;
}

function normalizeContext(value: unknown): ProductContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  return { platform: typeof v.platform === 'string' ? v.platform.slice(0, 40) : null, title: typeof v.title === 'string' ? v.title.slice(0, 300) : null };
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

  let etsy: NamedCommerceProvider | null = null;
  const etsyCreds = resolveEtsyCredentials(env);
  if (etsyCreds) {
    etsy = { name: 'etsy', provider: new EtsyCommerceProvider(etsyCreds) };
  }

  let brave: NamedCommerceProvider | null = null;
  const braveCreds = resolveBraveCredentials(env);
  if (braveCreds) {
    brave = { name: 'brave', provider: new BraveCommerceProvider(braveCreds.apiKey) };
  }

  if (env.COMMERCE_PROVIDER === 'serpapi') return serpapi ? [serpapi] : [];
  if (env.COMMERCE_PROVIDER === 'ebay') return ebay ? [ebay] : [];
  if (env.COMMERCE_PROVIDER === 'etsy') return etsy ? [etsy] : [];
  if (env.COMMERCE_PROVIDER === 'brave') return brave ? [brave] : [];

  return [serpapi, ebay].filter((entry): entry is NamedCommerceProvider => Boolean(entry));
}

export async function resolveProducts(providers: NamedCommerceProvider[], queries: ProductQuery[], description: ReturnType<typeof normalizeObjectDescription>, env: Env, context?: ProductContext, sourceImage?: ReturnType<typeof parseSourceImage>, imageVerifier = compareCandidateImages) {
  let attempts = 0; let sawProviderFailure = false; let activeProviders = [...providers]; const providersUsed = new Set<string>();
  const accepted: ProductCandidate[] = [];
  const seen = new Set<string>();
  const imageEvidence = new Map<string, ImageComparison>();
  const imageBudget = imageRequestBudget();
  const verification = { retrieved: 0, compared: 0, image_failures: 0, image_failure_reasons: {} as Record<string, number>, rejected: 0, contradictions: {} as Record<string, number> };
  const respond = (query: ProductQuery) => ({ query, products: dedupeProducts(rankVerified(accepted)),
    state: accepted.length ? 'RESULTS' as const : sawProviderFailure ? 'TEMPORARILY_UNAVAILABLE' as const : 'NO_RESULTS' as const,
    providers_used: [...providersUsed], attempts, verification });
  for (const query of queries) {
    if (!activeProviders.length) break;
    attempts++;
    const providersForAttempt = [...activeProviders];
    const settled = await Promise.allSettled(providersForAttempt.map(async ({ name, provider }) => { providersUsed.add(name); return provider.search(query); }));
    const products: ProductCandidate[] = []; const failedProviders = new Set<string>();
    settled.forEach((result, index) => {
      const providerName = providersForAttempt[index].name;
      if (result.status === 'fulfilled') { products.push(...result.value); return; }
      if (result.reason instanceof CommerceNoResultsError) return;
      sawProviderFailure = true; failedProviders.add(providerName); logSafeError(result.reason);
    });
    if (failedProviders.size) activeProviders = activeProviders.filter(({ name }) => !failedProviders.has(name));
    // No title/rank gate before image comparison. Bound work, but consider more than the UI's eight offers.
    const fresh = products.slice(0, 24).filter((product) => {
      const key = candidateKey(product); if (seen.has(key)) return false; seen.add(key); return true;
    });
    verification.retrieved += fresh.length;
    if (sourceImage && env.GEMINI_API_KEY && fresh.length) {
      const images = await imageVerifier(env.GEMINI_API_KEY, env.GEMINI_MODEL || 'gemini-3.5-flash-lite', sourceImage, description, fresh, context, imageBudget);
      verification.compared += images.compared;
      verification.image_failures += images.failures;
      for (const [reason, count] of Object.entries(images.failure_reasons ?? {})) verification.image_failure_reasons[reason] = (verification.image_failure_reasons[reason] ?? 0) + count;
      for (const [key, value] of images.comparisons) imageEvidence.set(key, value);
    }
    for (const product of fresh) {
      const decision = verifyCandidate(description, product, imageEvidence.get(candidateKey(product)), context);
      if (decision.product) accepted.push(decision.product);
      else {
        verification.rejected++;
        const reason = decision.reasons[0].split(':')[0];
        verification.contradictions[reason] = (verification.contradictions[reason] ?? 0) + 1;
      }
    }
    // A weak first page must not suppress the broader searches. No merchant/price ordering here.
    if (accepted.filter((product) => product.result_class === 'LIKELY').length >= 3) return respond(query);
  }
  return respond(queries[Math.max(0, Math.min(attempts - 1, queries.length - 1))]);
}

export default { async fetch(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  const path = new URL(request.url).pathname;
  if (request.method !== 'POST') return jsonResponse({ error: 'Not found' }, 404);
  try {
    if (path === '/analyze-selection') {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return jsonResponse({ error: 'dataUrl image is required' }, 400);
      const dataUrl = (parsed as { dataUrl?: unknown }).dataUrl;
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return jsonResponse({ error: 'dataUrl image is required' }, 400);
      const useGemini = env.VISION_PROVIDER === 'gemini'; const apiKey = useGemini ? env.GEMINI_API_KEY : env.GROQ_API_KEY;
      if (!apiKey) return jsonResponse({ error: `Missing ${useGemini ? 'GEMINI_API_KEY' : 'GROQ_API_KEY'}` }, 500);
      const provider = useGemini ? new GeminiVisionProvider(apiKey, env.GEMINI_MODEL) : new GroqVisionProvider(apiKey);
      return jsonResponse(normalizeObjectDescription(await provider.analyzeSelection(dataUrl)));
    }
    if (path === '/resolve-products') {
      const parsed: unknown = await request.json();
      const wrapped = Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'description' in parsed);
      const record = wrapped ? parsed as { description: unknown; context?: unknown; source_image?: unknown } : { description: parsed, context: undefined, source_image: undefined };
      const sourceImage = parseSourceImage(record.source_image);
      if (record.source_image != null && !sourceImage) return jsonResponse({ error: 'source_image must be a base64 JPEG, PNG, WebP or GIF crop under 2 MB' }, 400);
      const description = normalizeObjectDescription(record.description); const context = normalizeContext(record.context);
      const providers = commerceProviders(env); if (!providers.length) return jsonResponse({ error: 'No configured commerce provider' }, 503);
      const queries = buildProductQueryVariants(description, context); const started = Date.now(); const resolved = await resolveProducts(providers, queries, description, env, context, sourceImage);
      return jsonResponse({ ...resolved, latency_ms: Date.now() - started });
    }
    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) { logSafeError(error); return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown API error' }, 500); }
} };
