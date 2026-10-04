import { normalizeObjectDescription } from './types.js';
import { buildProductQueryVariants, CommerceNoResultsError, type CommerceProvider, type ProductCandidate, type ProductContext, type ProductQuery } from './commerce.js';
import { highConfidenceMetadataContradiction, verifyCandidate, rankVerified } from './candidate-verification.js';
import { candidateKey, compareCandidateImages, compareCandidateImagesWithClef, parseSourceImage, imageRequestBudget, type ClefVerificationBinding } from './candidate-images.js';
import { EbayAuth } from './ebay-auth.js';
import { EbayCommerceProvider } from './ebay-commerce.js';
import { resolveEbayCredentials } from './ebay-credentials.js';
import { EtsyCommerceProvider } from './etsy-commerce.js';
import { resolveEtsyCredentials } from './etsy-credentials.js';
import { SerpApiCommerceProvider } from './serpapi-commerce.js';
import { BraveCommerceProvider } from './brave-commerce.js';
import { resolveBraveCredentials } from './brave-credentials.js';
import { DEFAULT_OPENROUTER_MODEL } from './openrouter-vision.js';

type NamedProvider = { name: string; provider: CommerceProvider; tier: 'primary' | 'fallback' };

interface Env {
  AI?: ClefVerificationBinding;
  VISION_PROVIDER?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  COMMERCE_PROVIDER?: string;
  SERPAPI_API_KEY?: string;
  BRAVE_SEARCH_API_KEY?: string;
  ETSY_KEYSTRING?: string;
  ETSY_SHARED_SECRET?: string;
  EBAY_SANDBOX_CLIENT_ID?: string;
  EBAY_SANDBOX_CLIENT_SECRET?: string;
  EBAY_PRODUCTION_CLIENT_ID?: string;
  EBAY_PRODUCTION_CLIENT_SECRET?: string;
  EBAY_DEV_ID?: string;
  EBAY_ENVIRONMENT?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_SANDBOX?: string;
  EBAY_AFFILIATE_CAMPAIGN_ID?: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

function normalizeContext(value: unknown): ProductContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  return {
    platform: typeof v.platform === 'string' ? v.platform.slice(0, 40) : null,
    title: typeof v.title === 'string' ? v.title.slice(0, 300) : null,
    url: typeof v.url === 'string' ? v.url.slice(0, 1000) : null,
    content_ref: typeof v.content_ref === 'string' ? v.content_ref.slice(0, 180) : null,
    timestamp_ms: typeof v.timestamp_ms === 'number' && Number.isFinite(v.timestamp_ms) && v.timestamp_ms >= 0 ? Math.round(v.timestamp_ms) : null,
  };
}

function providers(env: Env): NamedProvider[] {
  let ebay: NamedProvider | null = null;
  const ebayCreds = resolveEbayCredentials(env);
  if (ebayCreds) {
    ebay = {
      name: 'ebay',
      provider: new EbayCommerceProvider(
        new EbayAuth({ clientId: ebayCreds.clientId, clientSecret: ebayCreds.clientSecret, sandbox: ebayCreds.sandbox }),
        2500,
        env.EBAY_AFFILIATE_CAMPAIGN_ID,
      ),
      tier: 'primary',
    };
  }

  let etsy: NamedProvider | null = null;
  const etsyCreds = resolveEtsyCredentials(env);
  if (etsyCreds) etsy = { name: 'etsy', provider: new EtsyCommerceProvider(etsyCreds), tier: 'primary' };

  const serpapi: NamedProvider | null = env.SERPAPI_API_KEY
    ? { name: 'serpapi', provider: new SerpApiCommerceProvider(env.SERPAPI_API_KEY), tier: 'fallback' }
    : null;

  const braveCreds = resolveBraveCredentials(env);
  const brave: NamedProvider | null = braveCreds
    ? { name: 'brave', provider: new BraveCommerceProvider(braveCreds.apiKey), tier: 'fallback' }
    : null;

  if (env.COMMERCE_PROVIDER === 'ebay') return ebay ? [ebay] : [];
  if (env.COMMERCE_PROVIDER === 'etsy') return etsy ? [etsy] : [];
  if (env.COMMERCE_PROVIDER === 'serpapi') return serpapi ? [serpapi] : [];
  if (env.COMMERCE_PROVIDER === 'brave') return brave ? [brave] : [];
  return [ebay, etsy, serpapi, brave].filter((entry): entry is NamedProvider => Boolean(entry));
}

const ETSY_ELIGIBLE = new Set(['apparel', 'fashion', 'shoes', 'sneakers', 'watch', 'watches', 'bag', 'bags', 'jewelry', 'accessories', 'vintage', 'handmade']);

function eligibleProviders(all: NamedProvider[], query: ProductQuery): NamedProvider[] {
  const text = `${query.category ?? ''} ${query.subcategory ?? ''} ${query.query}`.toLowerCase();
  return all.filter((provider) => provider.name !== 'etsy' || [...ETSY_ELIGIBLE].some((term) => text.includes(term)));
}

function dedupeProducts(products: ProductCandidate[]): ProductCandidate[] {
  const seen = new Set<string>();
  const out: ProductCandidate[] = [];
  for (const product of products) {
    const key = candidateKey(product);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(product);
  }
  return out;
}

async function collectRawCandidates(env: Env, description: ReturnType<typeof normalizeObjectDescription>, context: ProductContext | undefined, limit: number) {
  const allProviders = providers(env);
  if (!allProviders.length) throw new Error('No configured commerce providers');
  const queries = buildProductQueryVariants(description, context, false).slice(0, 3);
  const raw: ProductCandidate[] = [];
  const seen = new Set<string>();
  const retrieval: Array<{ query: string; provider: string; returned: number; failure?: string }> = [];
  const calls: Record<string, number> = {};

  for (const query of queries) {
    const eligible = eligibleProviders(allProviders, query);
    const settled = await Promise.allSettled(eligible.map(async ({ name, provider }) => {
      calls[name] = (calls[name] ?? 0) + 1;
      return { name, products: await provider.search(query) };
    }));

    settled.forEach((result, index) => {
      const name = eligible[index]?.name ?? 'unknown';
      if (result.status === 'rejected') {
        retrieval.push({
          query: query.query,
          provider: name,
          returned: 0,
          failure: result.reason instanceof CommerceNoResultsError
            ? 'NO_RESULTS'
            : result.reason instanceof Error ? result.reason.name : 'PROVIDER_ERROR',
        });
        return;
      }
      retrieval.push({ query: query.query, provider: name, returned: result.value.products.length });
      for (const product of result.value.products.slice(0, 8)) {
        const key = candidateKey(product);
        if (seen.has(key)) continue;
        seen.add(key);
        raw.push(product);
      }
    });
    if (raw.length >= limit) break;
  }

  return {
    queries,
    candidates: raw.slice(0, limit),
    retrieval,
    calls,
    providers_configured: allProviders.map((p) => p.name),
  };
}

async function verifyWithCurrent(
  env: Env,
  source: NonNullable<ReturnType<typeof parseSourceImage>>,
  description: ReturnType<typeof normalizeObjectDescription>,
  candidates: ProductCandidate[],
  context: ProductContext | undefined,
) {
  const started = Date.now();
  const result = env.VISION_PROVIDER === 'openrouter' && env.OPENROUTER_API_KEY
    ? await compareCandidateImages(
        env.OPENROUTER_API_KEY,
        env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
        source,
        description,
        candidates,
        context,
        imageRequestBudget(),
        { provider: 'openrouter' },
      )
    : env.GEMINI_API_KEY
      ? await compareCandidateImages(
          env.GEMINI_API_KEY,
          env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
          source,
          description,
          candidates,
          context,
          imageRequestBudget(),
          { provider: 'gemini' },
        )
      : (() => { throw new Error('Current verifier credentials unavailable'); })();

  const decisions = candidates.map((candidate) => {
    const decision = verifyCandidate(description, candidate, result.comparisons.get(candidateKey(candidate)), context, false);
    return {
      candidate_key: candidateKey(candidate),
      accepted: Boolean(decision.product),
      product: decision.product ?? null,
      reasons: decision.reasons,
    };
  });

  return {
    products: dedupeProducts(rankVerified(decisions.flatMap((row) => row.product ? [row.product] : []))),
    decisions,
    compared: result.compared,
    failures: result.failures,
    failure_reasons: result.failure_reasons,
    usage: result.usage ?? null,
    timing: { ...(result.timing ?? {}), wall_ms: Date.now() - started },
  };
}

async function verifyWithClef(
  env: Env,
  source: NonNullable<ReturnType<typeof parseSourceImage>>,
  description: ReturnType<typeof normalizeObjectDescription>,
  candidates: ProductCandidate[],
  context: ProductContext | undefined,
) {
  if (!env.AI) throw new Error('Workers AI binding unavailable');
  const started = Date.now();
  const result = await compareCandidateImagesWithClef(
    env.AI,
    'workers-ai-binding',
    '@cf/cloudflare/clef',
    source,
    description,
    candidates,
    context,
    imageRequestBudget(),
  );

  const decisions = candidates.map((candidate) => {
    const decision = verifyCandidate(description, candidate, result.comparisons.get(candidateKey(candidate)), context, false);
    return {
      candidate_key: candidateKey(candidate),
      accepted: Boolean(decision.product),
      product: decision.product ?? null,
      reasons: decision.reasons,
    };
  });

  return {
    products: dedupeProducts(rankVerified(decisions.flatMap((row) => row.product ? [row.product] : []))),
    decisions,
    compared: result.compared,
    failures: result.failures,
    failure_reasons: result.failure_reasons,
    usage: result.usage ?? null,
    timing: { ...(result.timing ?? {}), wall_ms: Date.now() - started },
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'GET') return json({ service: 'clef-raw-verifier-ab', status: 'ok' });
    if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

    try {
      const body = await request.json() as Record<string, unknown>;
      const description = normalizeObjectDescription(body.description);
      const context = normalizeContext(body.context);
      const source = parseSourceImage(body.source_image);
      if (!source) return json({ error: 'source_image is required' }, 400);
      const candidateLimit = Math.max(1, Math.min(12, Number(body.candidate_limit ?? 8) || 8));

      const retrievalStarted = Date.now();
      const raw = await collectRawCandidates(env, description, context, candidateLimit);
      const retrievalMs = Date.now() - retrievalStarted;
      if (!raw.candidates.length) {
        return json({
          benchmark: 'raw-candidate-current-vs-clef-v1',
          raw_candidates: [],
          retrieval: raw,
          error: 'No raw commerce candidates',
        }, 422);
      }

      const metadataRejected: Array<{ candidate_key: string; reason: string }> = [];
      const viable = raw.candidates.filter((candidate) => {
        const contradiction = highConfidenceMetadataContradiction(description, candidate);
        if (!contradiction) return true;
        metadataRejected.push({ candidate_key: candidateKey(candidate), reason: contradiction });
        return false;
      });

      const [current, clef] = await Promise.all([
        verifyWithCurrent(env, source, description, viable, context),
        verifyWithClef(env, source, description, viable, context),
      ]);

      return json({
        benchmark: 'raw-candidate-current-vs-clef-v1',
        candidate_limit: candidateLimit,
        raw_candidate_count: raw.candidates.length,
        viable_candidate_count: viable.length,
        raw_candidates: raw.candidates,
        metadata_rejected: metadataRejected,
        retrieval: {
          queries: raw.queries,
          calls: raw.calls,
          rows: raw.retrieval,
          providers_configured: raw.providers_configured,
          latency_ms: retrievalMs,
        },
        current,
        clef,
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
};
