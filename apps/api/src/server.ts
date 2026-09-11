import { GeminiVisionProvider } from './gemini-vision.js';
import { GroqVisionProvider } from './groq-vision.js';
import { normalizeObjectDescription } from './types.js';
import { CommerceNoResultsError, buildProductQueryVariants, verifyProductCandidate, type CommerceProvider, type ProductCandidate, type ProductContext, type ProductQuery } from './commerce.js';
import { EbayCommerceProvider } from './ebay-commerce.js';
import { SerpApiCommerceProvider } from './serpapi-commerce.js';

export interface Env { GEMINI_API_KEY?: string; GROQ_API_KEY?: string; VISION_PROVIDER?: string; GEMINI_MODEL?: string; EBAY_ACCESS_TOKEN?: string; SERPAPI_API_KEY?: string; COMMERCE_PROVIDER?: string; }
type NamedCommerceProvider = { name: string; provider: CommerceProvider };
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
function logSafeError(error: unknown) { console.error('VCL API error', error instanceof Error ? { name: error.name, message: error.message } : { name: typeof error, message: String(error) }); }

function commerceProviders(env: Env): NamedCommerceProvider[] {
  const providers: NamedCommerceProvider[] = [];
  if (env.SERPAPI_API_KEY) providers.push({ name: 'serpapi', provider: new SerpApiCommerceProvider(env.SERPAPI_API_KEY) });
  if (env.EBAY_ACCESS_TOKEN) providers.push({ name: 'ebay', provider: new EbayCommerceProvider(env.EBAY_ACCESS_TOKEN) });
  if (env.COMMERCE_PROVIDER === 'serpapi') return providers.filter(({ name }) => name === 'serpapi');
  if (env.COMMERCE_PROVIDER === 'ebay') return providers.filter(({ name }) => name === 'ebay');
  return providers;
}

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

async function resolveProducts(providers: NamedCommerceProvider[], queries: ProductQuery[], description: ReturnType<typeof normalizeObjectDescription>, context?: ProductContext) {
  let attempts = 0; let sawProviderFailure = false; let activeProviders = [...providers]; const providersUsed = new Set<string>();
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
    const verified = products.map((product) => verifyProductCandidate(description, product, context)).filter((product): product is ProductCandidate => Boolean(product)).sort((a, b) => (b.verification_score ?? 0) - (a.verification_score ?? 0));
    const deduped = dedupeProducts(verified);
    if (deduped.length) return { query, products: deduped, state: 'RESULTS' as const, providers_used: [...providersUsed], attempts };
    if (!activeProviders.length && sawProviderFailure) return { query, products: [], state: 'TEMPORARILY_UNAVAILABLE' as const, providers_used: [...providersUsed], attempts };
  }
  return { query: queries[Math.max(0, Math.min(attempts - 1, queries.length - 1))], products: [], state: sawProviderFailure ? 'TEMPORARILY_UNAVAILABLE' as const : 'NO_RESULTS' as const, providers_used: [...providersUsed], attempts };
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
      const record = wrapped ? parsed as { description: unknown; context?: unknown } : { description: parsed, context: undefined };
      const description = normalizeObjectDescription(record.description); const context = normalizeContext(record.context);
      const providers = commerceProviders(env); if (!providers.length) return jsonResponse({ error: 'No configured commerce provider' }, 503);
      const queries = buildProductQueryVariants(description, context); const started = Date.now(); const resolved = await resolveProducts(providers, queries, description, context);
      return jsonResponse({ ...resolved, latency_ms: Date.now() - started });
    }
    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) { logSafeError(error); return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown API error' }, 500); }
} };
