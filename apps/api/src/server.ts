import { GeminiVisionProvider, VisionProviderError } from './gemini-vision.js';
import { GroqVisionProvider } from './groq-vision.js';
import { CloudflareVisionProvider, type CloudflareVisionBinding } from './cloudflare-vision.js';
import { OpenRouterVisionProvider, DEFAULT_OPENROUTER_MODEL } from './openrouter-vision.js';
import { analyzeWithNearbyFrames, mergeFrameEvidence, parseEvidenceFrames } from './multi-frame-evidence.js';
import { normalizeObjectDescription } from './types.js';
import { mergeOcrEvidence, shouldRunOcrRecovery } from './ocr-evidence.js';
import { parseSelectionPoint, TargetLocalizationError, type SelectionPoint } from './selection-target.js';
import { CommerceNoResultsError, buildProductQueryVariants, type CommerceProvider, type ProductCandidate, type ProductContext, type ProductQuery } from './commerce.js';
import { highConfidenceMetadataContradiction, verifyCandidate, rankVerified } from './candidate-verification.js';
import { canonical } from './verification-evidence.js';
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
import { routeWithJev, routerInput, type JevRouterTelemetry } from './jev-router.js';
import { routeWithJevFabric } from './jev-fabric.js';
import type { WorkersAiBinding } from './jev.js';
import { resolveJevBinding } from './jev-binding.js';
import { normalizeAlphaTelemetry, recordAlphaFeedback, recordAlphaScoop } from './alpha-telemetry.js';
import { applyFeedbackPenalties, evidenceFingerprint, feedbackCandidateKey, feedbackPenalties, feedbackReport, persistFeedback, persistFeedbackContext, FEEDBACK_RANKING_POLICY, type DurableObjectNamespaceLike } from './feedback-ledger.js';
export { FeedbackLedger } from './feedback-ledger.js';
import { creatorForContent, makeAttribution, makeCommerceClickRef, recordCommerceClick, verifyAttributionToken } from './commerce-attribution.js';
import { activateAlphaInvite, alphaInviteRequired, authorizeAlphaRequest, createAlphaInvite, type DurableObjectNamespaceLike as AlphaAccessNamespaceLike } from './alpha-access.js';
import { lookupVerifiedProductMapping, verifiedMappingProduct, type VerifiedProductMapping } from './verified-product-mapping.js';
import { durableVerifiedMappings, persistAdminVerifiedMapping, revokeAdminVerifiedMapping, type VerifiedProductLedgerNamespaceLike } from './verified-product-ledger.js';
import { authorizeAdminSession, createAdminInvite, createBootstrapAdmin, redeemAdminInvite, auditAdminAction, type AdminAccessNamespaceLike } from './admin-access.js';
export { AlphaAccessLedger } from './alpha-access.js';
export { VerifiedProductLedger } from './verified-product-ledger.js';
export { AdminAccessLedger } from './admin-access.js';

export interface Env {
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  VISION_PROVIDER?: string;
  GEMINI_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
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
  SERPAPI_API_KEY?: string;
  COMMERCE_PROVIDER?: string;
  ETSY_KEYSTRING?: string;
  ETSY_SHARED_SECRET?: string;
  BRAVE_SEARCH_API_KEY?: string;
  JEV_DECISION_ROUTER?: string;
  JEV_MODE?: string;
  BENCHMARK_MODE?: string;
  VISIBLE_TEXT_QUERY_V2?: string;
  AI_GATEWAY_API_KEY?: string;
  ALPHA_ENABLED?: string;
  ALPHA_ATTRIBUTION_SECRET?: string;
  ALPHA_FEEDBACK_ADMIN_TOKEN?: string;
  ALPHA_CREATOR_CONTENT_MAP?: string;
  VERIFIED_PRODUCT_MAPPINGS_JSON?: string;
  VERIFIED_PRODUCT_TEST_MODE?: string;
  ALPHA_INSTALL_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  ALPHA_GLOBAL_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  AI?: WorkersAiBinding & CloudflareVisionBinding;
  FEEDBACK_LEDGER?: DurableObjectNamespaceLike;
  ALPHA_INVITE_REQUIRED?: string;
  ALPHA_INVITE_SECRET?: string;
  ALPHA_ACCESS_LEDGER?: AlphaAccessNamespaceLike;
  VERIFIED_PRODUCT_LEDGER?: VerifiedProductLedgerNamespaceLike;
  ADMIN_ACCESS_LEDGER?: AdminAccessNamespaceLike;
}

type NamedCommerceProvider = { name: string; provider: CommerceProvider; tier: 'primary' | 'fallback' };
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-scoop-install-id,x-scoop-admin-session,x-scoop-alpha-token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

type VisionProviderName = 'openrouter' | 'gemini' | 'groq-3.8' | 'groq-3.6' | 'cloudflare';
const visionCooldownUntil = new Map<VisionProviderName, number>();
const visionFailureReason = new Map<VisionProviderName, string>();

function visionCooldownMs(error: unknown): number {
  const reason = error instanceof VisionProviderError ? error.reason : 'PROVIDER_ERROR';
  if (reason === 'QUOTA_EXHAUSTED' || reason === 'PROVIDER_AUTH') return 15 * 60_000;
  if (reason === 'RATE_LIMITED') return 60_000;
  if (reason === 'PROVIDER_5XX' || reason === 'PROVIDER_TIMEOUT') return 15_000;
  return 10_000;
}

function visionCircuitOpen(name: VisionProviderName): boolean {
  return (visionCooldownUntil.get(name) ?? 0) > Date.now();
}

function markVisionFailure(name: VisionProviderName, error: unknown) {
  const reason = error instanceof VisionProviderError ? error.reason : 'PROVIDER_ERROR';
  if (reason === 'PROVIDER_ERROR') {
    visionCooldownUntil.delete(name);
    visionFailureReason.delete(name);
    return;
  }
  visionCooldownUntil.set(name, Date.now() + visionCooldownMs(error));
  visionFailureReason.set(name, reason);
}

function markVisionSuccess(name: VisionProviderName) {
  visionCooldownUntil.delete(name);
  visionFailureReason.delete(name);
}
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
function logSafeError(error: unknown) { console.error('VCL API error', error instanceof Error ? { name: error.name, message: error.message } : { name: typeof error, message: String(error) }); }
function recordFailureState(stage: 'localization' | 'vision' | 'commerce', reason: string, retryable: boolean) {
  console.warn?.('Scoop failure state', { stage, reason: reason.slice(0, 80), retryable });
}

async function readAnalysisBody(request: Request): Promise<unknown> {
  const limit = 8_500_000;
  if (Number(request.headers.get('content-length')) > limit || !request.body) throw new Error('Invalid analysis body');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0; let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('Analysis body too large'); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

function dedupeProducts(products: ProductCandidate[]) {
  const seen = new Set<string>(); const out: ProductCandidate[] = [];
  for (const product of products) { const key = product.destination || `${product.provenance}:${product.id}`; if (seen.has(key)) continue; seen.add(key); out.push(product); if (out.length >= 8) break; }
  return out;
}

function normalizeContext(value: unknown): ProductContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  return {
    platform: typeof v.platform === 'string' ? v.platform.slice(0, 40) : null,
    title: typeof v.title === 'string' ? v.title.slice(0, 300) : null,
    content_ref: typeof v.content_ref === 'string' ? v.content_ref.slice(0, 180) : null,
    timestamp_ms: typeof v.timestamp_ms === 'number' && Number.isFinite(v.timestamp_ms) && v.timestamp_ms >= 0 ? Math.round(v.timestamp_ms) : null,
  };
}

function makeEbayAuth(creds: EbayCredentials): EbayAuth {
  return new EbayAuth({ clientId: creds.clientId, clientSecret: creds.clientSecret, sandbox: creds.sandbox });
}

function commerceProviders(env: Env): NamedCommerceProvider[] {
  let serpapi: NamedCommerceProvider | null = null;
  if (env.SERPAPI_API_KEY) serpapi = { name: 'serpapi', provider: new SerpApiCommerceProvider(env.SERPAPI_API_KEY), tier: 'fallback' };

  let ebay: NamedCommerceProvider | null = null;
  const ebayCreds = resolveEbayCredentials(env);
  if (ebayCreds) ebay = { name: 'ebay', provider: new EbayCommerceProvider(makeEbayAuth(ebayCreds), 2500, env.EBAY_AFFILIATE_CAMPAIGN_ID), tier: 'primary' };

  let etsy: NamedCommerceProvider | null = null;
  const etsyCreds = resolveEtsyCredentials(env);
  if (etsyCreds) etsy = { name: 'etsy', provider: new EtsyCommerceProvider(etsyCreds), tier: 'primary' };

  let brave: NamedCommerceProvider | null = null;
  const braveCreds = resolveBraveCredentials(env);
  if (braveCreds) brave = { name: 'brave', provider: new BraveCommerceProvider(braveCreds.apiKey), tier: 'fallback' };

  if (env.COMMERCE_PROVIDER === 'serpapi') return serpapi ? [serpapi] : [];
  if (env.COMMERCE_PROVIDER === 'ebay') return ebay ? [ebay] : [];
  if (env.COMMERCE_PROVIDER === 'etsy') return etsy ? [etsy] : [];
  if (env.COMMERCE_PROVIDER === 'brave') return brave ? [brave] : [];
  return [ebay, etsy, serpapi, brave].filter((entry): entry is NamedCommerceProvider => Boolean(entry));
}

const ETSY_ELIGIBLE_CATEGORIES = new Set(['apparel', 'fashion', 'shoes', 'watches', 'bags', 'jewelry', 'accessories', 'vintage', 'handmade']);

function isEtsyEligible(query: ProductQuery): boolean {
  const category = (query.category ?? '').toLowerCase();
  const subcategory = (query.subcategory ?? '').toLowerCase();
  if (ETSY_ELIGIBLE_CATEGORIES.has(category) || ETSY_ELIGIBLE_CATEGORIES.has(subcategory)) return true;
  const normalized = [canonical('category', category), canonical('category', subcategory)];
  if (normalized.some(value => value && ['apparel', 'shoes', 'watch', 'bag'].includes(value))) return true;
  const text = `${category} ${subcategory} ${query.query}`.toLowerCase();
  for (const eligible of ETSY_ELIGIBLE_CATEGORIES) if (text.includes(eligible)) return true;
  return false;
}

function filterByCategory(providers: NamedCommerceProvider[], query: ProductQuery): NamedCommerceProvider[] {
  return providers.filter((p) => p.name !== 'etsy' || isEtsyEligible(query));
}

const LIKELY_CANDIDATE_THRESHOLD = 3;
const SUFFICIENT_CANDIDATE_THRESHOLD = 3;

function verifiedIdentityTokens(value: string): string[] {
  const stop = new Set(['the','a','an','and','or','for','with','to','of','in','on','by','unisex','men','women','mens','womens']);
  return (canonical('model', value) ?? '').split(' ').filter((token) => token.length > 1 && !stop.has(token));
}

function verifiedOfferHasExactIdentity(mapping: VerifiedProductMapping, product: ProductCandidate): boolean {
  return Boolean(product.model && mapping.product_id
    && canonical('model', product.model) === canonical('model', mapping.product_id));
}

function verifiedOfferTitleSimilar(mapping: VerifiedProductMapping, product: ProductCandidate): boolean {
  const expected = verifiedIdentityTokens(mapping.title);
  const actual = new Set(verifiedIdentityTokens(product.title));
  if (!expected.length) return false;
  const overlap = expected.filter((token) => actual.has(token)).length / expected.length;
  return expected.length >= 3 ? overlap >= 0.72 : overlap === 1;
}

async function refreshVerifiedOffers(
  providers: NamedCommerceProvider[],
  mapping: VerifiedProductMapping,
): Promise<{ products: ProductCandidate[]; providers_used: string[]; commerce_calls: Record<string, number>; provider_retrieval_ms: number }> {
  const query: ProductQuery = {
    query: mapping.title,
    category: mapping.object_type,
    subcategory: mapping.object_type,
    brand: mapping.brand || null,
    model: mapping.product_id || null,
    attributes: [],
  };
  const eligible = filterByCategory(providers, query);
  const providersUsed: string[] = [];
  const commerceCalls: Record<string, number> = {};
  const started = Date.now();
  const batches = await Promise.all(eligible.map(async ({ name, provider }) => {
    providersUsed.push(name);
    commerceCalls[name] = (commerceCalls[name] ?? 0) + 1;
    try {
      return await provider.search(query);
    } catch (error) {
      if (!(error instanceof CommerceNoResultsError)) logSafeError(error);
      return [];
    }
  }));
  const fallback = verifiedMappingProduct(mapping);
  const refreshed = batches.flat()
    .filter((product) => verifiedOfferTitleSimilar(mapping, product))
    .map((product): ProductCandidate => {
      const exactIdentity = verifiedOfferHasExactIdentity(mapping, product);
      return {
        ...product,
        result_class: exactIdentity ? 'EXACT' : 'SIMILAR',
        provenance: exactIdentity ? mapping.provenance : product.provenance,
        provider: product.provider || product.provenance || mapping.provider || 'verified',
        identity_key: exactIdentity ? `verified:${mapping.product_id}` : product.identity_key,
        verification_status: exactIdentity ? 'metadata_only' : product.verification_status,
        verification_score: exactIdentity ? 100 : product.verification_score,
        verification_reasons: exactIdentity
          ? [`${mapping.provenance} product identity; fresh merchant offer`]
          : ['Title is similar to the verified product, but SKU/model identity was not confirmed'],
      };
    });
  return {
    products: dedupeProducts([...refreshed, fallback]).slice(0, 5),
    providers_used: providersUsed,
    commerce_calls: commerceCalls,
    provider_retrieval_ms: Date.now() - started,
  };
}

export async function resolveProducts(providers: NamedCommerceProvider[], queries: ProductQuery[], description: ReturnType<typeof normalizeObjectDescription>, env: Env, context?: ProductContext, sourceImage?: ReturnType<typeof parseSourceImage>, imageVerifier = compareCandidateImages, routing?: { commerce_action: 'SKIP' | 'SEARCH_NORMAL' | 'SEARCH_BROAD'; verification_action: 'LIGHT' | 'FULL'; telemetry: JevRouterTelemetry; broad_search_on_miss?: boolean }, useMarkingEvidence = false) {
  const routingActive = Boolean(routing && !routing.telemetry.failed);
  let attempts = 0;
  let sawProviderFailure = false;
  let completedProviderAttempt = false;
  let activeProviders = [...providers];
  const providersUsed = new Set<string>();
  const accepted: ProductCandidate[] = [];
  const seen = new Set<string>();
  const imageEvidence = new Map<string, ImageComparison>();
  const imageBudget = imageRequestBudget();
  const verification = { retrieved: 0, metadata_prefiltered: 0, light_escalations: 0, compared: 0, image_failures: 0, image_failure_reasons: {} as Record<string, number>, rejected: 0, contradictions: {} as Record<string, number> };
  const timing = {
    provider_retrieval_ms: 0,
    candidate_verification_ms: 0,
    candidate_image_fetch_ms: 0,
    candidate_model_verification_ms: 0,
    verification_batches: [] as Array<{
      batch_index: number;
      candidates: number;
      images_loaded: number;
      comparisons: number;
      image_fetch_ms: number;
      model_ms: number;
      total_ms: number;
    }>,
  };
  const commerceCalls: Record<string, number> = {};
  const useOpenRouterVerification = env.VISION_PROVIDER === 'openrouter' && Boolean(env.OPENROUTER_API_KEY);
  const verificationUsage = {
    provider: useOpenRouterVerification ? 'openrouter' : 'gemini',
    model: useOpenRouterVerification ? (env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL) : (env.GEMINI_MODEL || 'gemini-3.5-flash-lite'),
    requests: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
  };
  const noteCommerceCall = (name: string) => { commerceCalls[name] = (commerceCalls[name] ?? 0) + 1; };

  const serpapiProvider = providers.find((p) => p.name === 'serpapi') ?? null;
  const braveProvider = providers.find((p) => p.name === 'brave') ?? null;
  let skipSerpApi = false;
  const serpapiTelemetry: { invoked: boolean; skipped: boolean; skip_reason?: string; success: boolean; no_result: boolean; timeout_or_failure: boolean; quota_exhausted: boolean; remaining_quota?: number } = { invoked: false, skipped: false, success: false, no_result: false, timeout_or_failure: false, quota_exhausted: false };
  const braveTelemetry: { invoked: boolean; skipped: boolean; skip_reason?: string; success: boolean; no_result: boolean; timeout_or_failure: boolean } = { invoked: false, skipped: false, success: false, no_result: false, timeout_or_failure: false };

  const respond = (query: ProductQuery) => {
    if (serpapiProvider && serpapiProvider.provider instanceof SerpApiCommerceProvider) {
      const quota = serpapiProvider.provider.getQuotaInfo();
      serpapiTelemetry.remaining_quota = quota.total_searches_left;
      if (serpapiProvider.provider.isQuotaExhausted()) {
        serpapiTelemetry.quota_exhausted = true;
        serpapiTelemetry.skipped = true;
        serpapiTelemetry.skip_reason = 'quota_exhausted';
      }
    }
    const state = accepted.length
      ? 'RESULTS' as const
      : completedProviderAttempt
        ? 'NO_RESULTS' as const
        : sawProviderFailure
          ? 'TEMPORARILY_UNAVAILABLE' as const
          : 'NO_RESULTS' as const;
    return {
      query,
      products: dedupeProducts(rankVerified(accepted)),
      state,
      providers_configured: providers.map((p) => p.name),
      providers_used: [...providersUsed],
      attempts,
      verification,
      timing,
      serpapi: serpapiTelemetry,
      brave: braveTelemetry,
      cost_usage: { commerce_calls: { ...commerceCalls }, verification_usage: { ...verificationUsage } },
      jev_router: routing?.telemetry,
    };
  };

  if (routingActive && routing?.commerce_action === 'SKIP') return respond(queries[0] ?? { query: '', category: description.category, subcategory: description.subcategory, brand: null, model: null, attributes: [] });

  const verifyFresh = async (products: ProductCandidate[]) => {
    const fresh = products.slice(0, 8).filter((product) => {
      const key = candidateKey(product); if (seen.has(key)) return false; seen.add(key); return true;
    });
    verification.retrieved += fresh.length;
    const verificationStarted = Date.now();
    const viable = fresh.filter((product) => {
      const contradiction = highConfidenceMetadataContradiction(description, product);
      if (!contradiction) return true;
      verification.metadata_prefiltered++;
      verification.rejected++;
      const reason = contradiction.split(':')[0];
      verification.contradictions[reason] = (verification.contradictions[reason] ?? 0) + 1;
      return false;
    });

    const runImageVerification = async () => {
      const verificationKey = useOpenRouterVerification ? env.OPENROUTER_API_KEY : env.GEMINI_API_KEY;
      if (!sourceImage || !verificationKey || !viable.length) return;
      const verificationModel = useOpenRouterVerification ? (env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL) : (env.GEMINI_MODEL || 'gemini-3.5-flash-lite');
      const images = await imageVerifier(
        verificationKey,
        verificationModel,
        sourceImage,
        description,
        viable,
        context,
        imageBudget,
        { provider: useOpenRouterVerification ? 'openrouter' : 'gemini' },
      );
      verification.compared += images.compared;
      verification.image_failures += images.failures;
      verificationUsage.requests += images.usage?.requests ?? 0;
      verificationUsage.prompt_tokens += images.usage?.prompt_tokens ?? 0;
      verificationUsage.completion_tokens += images.usage?.completion_tokens ?? 0;
      verificationUsage.total_tokens += images.usage?.total_tokens ?? 0;
      verificationUsage.cost_usd += images.usage?.cost_usd ?? 0;
      timing.candidate_image_fetch_ms += images.timing?.image_fetch_ms ?? 0;
      timing.candidate_model_verification_ms += images.timing?.model_ms ?? 0;
      timing.verification_batches.push(...(images.timing?.batches ?? []));
      for (const [reason, count] of Object.entries(images.failure_reasons ?? {})) verification.image_failure_reasons[reason] = (verification.image_failure_reasons[reason] ?? 0) + count;
      for (const [key, value] of images.comparisons) imageEvidence.set(key, value);
    };

    const lightMode = routingActive && routing?.verification_action === 'LIGHT';
    if (!lightMode) await runImageVerification();

    let decisions = viable.map((product) => ({ product, decision: verifyCandidate(description, product, imageEvidence.get(candidateKey(product)), context, useMarkingEvidence) }));
    if (lightMode && viable.length && !decisions.some(({ decision }) => decision.product) && sourceImage && (useOpenRouterVerification ? env.OPENROUTER_API_KEY : env.GEMINI_API_KEY)) {
      verification.light_escalations++;
      await runImageVerification();
      decisions = viable.map((product) => ({ product, decision: verifyCandidate(description, product, imageEvidence.get(candidateKey(product)), context, useMarkingEvidence) }));
    }

    for (const { decision } of decisions) {
      if (decision.product) accepted.push(decision.product);
      else {
        verification.rejected++;
        const reason = decision.reasons[0].split(':')[0];
        verification.contradictions[reason] = (verification.contradictions[reason] ?? 0) + 1;
      }
    }
    timing.candidate_verification_ms += Date.now() - verificationStarted;
  };

  for (const query of queries) {
    if (!activeProviders.length) break;
    attempts++;
    const eligibleProviders = filterByCategory(activeProviders, query);
    const activePrimary = eligibleProviders.filter((p) => p.tier === 'primary');

    if (activePrimary.length) {
      const retrievalStarted = Date.now();
      const settled = await Promise.allSettled(activePrimary.map(async ({ name, provider }) => { providersUsed.add(name); noteCommerceCall(name); return provider.search(query); }));
      timing.provider_retrieval_ms += Date.now() - retrievalStarted;
      const products: ProductCandidate[] = [];
      const failedProviders = new Set<string>();
      settled.forEach((result, index) => {
        const providerName = activePrimary[index].name;
        if (result.status === 'fulfilled') {
          completedProviderAttempt = true;
          products.push(...result.value);
          return;
        }
        if (result.reason instanceof CommerceNoResultsError) {
          completedProviderAttempt = true;
          return;
        }
        sawProviderFailure = true;
        failedProviders.add(providerName);
        logSafeError(result.reason);
      });
      if (failedProviders.size) activeProviders = activeProviders.filter(({ name }) => !failedProviders.has(name));
      await verifyFresh(products);
    }

    if (accepted.length >= SUFFICIENT_CANDIDATE_THRESHOLD) {
      braveTelemetry.skipped = true;
      braveTelemetry.skip_reason ??= 'upstream_sufficient';
      serpapiTelemetry.skipped = true;
      serpapiTelemetry.skip_reason ??= 'upstream_sufficient';
      skipSerpApi = true;
    }

    if (accepted.filter((product) => product.result_class === 'LIKELY').length >= LIKELY_CANDIDATE_THRESHOLD) return respond(query);

    const shouldSkipBrave = accepted.length >= SUFFICIENT_CANDIDATE_THRESHOLD;
    if (!shouldSkipBrave && braveProvider && eligibleProviders.some((a) => a.name === 'brave')) {
      braveTelemetry.invoked = true;
      let result;
      const retrievalStarted = Date.now();
      try {
        providersUsed.add('brave');
        noteCommerceCall('brave');
        result = await braveProvider.provider.search(query);
        completedProviderAttempt = true;
        braveTelemetry.success = true;
      } catch (error) {
        if (error instanceof CommerceNoResultsError) {
          completedProviderAttempt = true;
          braveTelemetry.no_result = true;
        } else {
          sawProviderFailure = true;
          braveTelemetry.timeout_or_failure = true;
          logSafeError(error);
          activeProviders = activeProviders.filter(({ name }) => name !== 'brave');
        }
      } finally { timing.provider_retrieval_ms += Date.now() - retrievalStarted; }
      if (result) await verifyFresh(result);
    } else if (!braveProvider && !braveTelemetry.skip_reason) {
      braveTelemetry.skipped = true;
      braveTelemetry.skip_reason = 'not_configured';
    }

    const shouldSkipSerpApi = skipSerpApi || accepted.length >= SUFFICIENT_CANDIDATE_THRESHOLD;
    if (shouldSkipSerpApi && !serpapiTelemetry.skip_reason) {
      serpapiTelemetry.skipped = true;
      serpapiTelemetry.skip_reason = 'upstream_sufficient';
    }

    if (!shouldSkipSerpApi && serpapiProvider && eligibleProviders.some((a) => a.name === 'serpapi')) {
      serpapiTelemetry.invoked = true;
      let result;
      const retrievalStarted = Date.now();
      try {
        providersUsed.add('serpapi');
        noteCommerceCall('serpapi');
        result = await serpapiProvider.provider.search(query);
        completedProviderAttempt = true;
        serpapiTelemetry.success = true;
      } catch (error) {
        if (error instanceof CommerceNoResultsError) {
          completedProviderAttempt = true;
          serpapiTelemetry.no_result = true;
        } else {
          const msg = error instanceof Error ? error.message : '';
          const quotaExhausted = msg.includes('quota exhausted') || msg.includes('HTTP 429');
          serpapiTelemetry.timeout_or_failure = !quotaExhausted;
          if (quotaExhausted) {
            serpapiTelemetry.quota_exhausted = true;
            serpapiTelemetry.skipped = true;
            serpapiTelemetry.skip_reason = 'quota_exhausted';
            skipSerpApi = true;
          } else {
            sawProviderFailure = true;
          }
          logSafeError(error);
          activeProviders = activeProviders.filter(({ name }) => name !== 'serpapi');
        }
      } finally { timing.provider_retrieval_ms += Date.now() - retrievalStarted; }
      if (result) await verifyFresh(result);
    } else if (!serpapiProvider && !serpapiTelemetry.skip_reason) {
      serpapiTelemetry.skipped = true;
      serpapiTelemetry.skip_reason = 'not_configured';
    }

    if (accepted.filter((product) => product.result_class === 'LIKELY').length >= 3) return respond(query);

    // SEARCH_NORMAL means normal-first, not normal-only. Stop after the first query
    // when it produces an acceptable candidate; otherwise continue to broader variants.
    if (routingActive && routing?.commerce_action === 'SEARCH_NORMAL' && attempts === 1 && accepted.length > 0) return respond(query);
  }

  return respond(queries[Math.max(0, Math.min(attempts - 1, queries.length - 1))]);
}

export default { async fetch(request: Request, env: Env, ctx?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === '/health') {
    return jsonResponse({ service: 'vcl-api', status: 'ok' });
  }
  if (request.method === 'GET' && path === '/alpha/status') {
    if (!alphaInviteRequired(env)) return jsonResponse({ required: false, active: true });
    const active = await authorizeAlphaRequest(env, request);
    return jsonResponse({ required: true, active });
  }
  if (request.method === 'GET' && path === '/admin/status') {
    return jsonResponse(await authorizeAdminSession(env, request.headers.get('x-scoop-admin-session') ?? ''));
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Not found' }, 404);
  if (env.ALPHA_ENABLED === 'false' && path !== '/feedback' && path !== '/commerce-click') {
    return jsonResponse({ error: 'Scoop alpha is temporarily paused', reason: 'ALPHA_DISABLED', failure_state: 'TEMPORARILY_UNAVAILABLE', retryable: false }, 503);
  }
  try {
    if (path === '/admin/auth') {
      const body = await request.json() as Record<string, unknown>;
      const credential = typeof body.credential === 'string' ? body.credential.trim() : '';
      const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : 'Admin';
      if (!credential) return jsonResponse({ error: 'Admin credential required' }, 400);
      const master = env.ALPHA_FEEDBACK_ADMIN_TOKEN || env.ALPHA_ATTRIBUTION_SECRET;
      const session = master && credential === master
        ? await createBootstrapAdmin(env, label || 'Owner')
        : await redeemAdminInvite(env, credential, label || 'Admin');
      return session ? jsonResponse({ admin: true, ...session }) : jsonResponse({ error: 'Invalid or expired admin credential' }, 403);
    }
    if (path === '/admin/invite') {
      const sessionToken = request.headers.get('x-scoop-admin-session') ?? '';
      const authorized = await authorizeAdminSession(env, sessionToken);
      if (!authorized.admin || !authorized.admin_id) return jsonResponse({ error: 'Unauthorized' }, 401);
      const invite = await createAdminInvite(env, sessionToken);
      if (!invite) return jsonResponse({ error: 'Could not create admin invite' }, 500);
      await auditAdminAction(env, authorized.admin_id, 'admin_invite_created');
      return jsonResponse(invite);
    }
    if (path === '/alpha/activate') {
      const body = await request.json() as Record<string, unknown>;
      const token = typeof body.token === 'string' ? body.token : '';
      const installId = typeof body.install_id === 'string' ? body.install_id : '';
      const activated = await activateAlphaInvite(env, token, installId);
      return activated.accepted
        ? jsonResponse({ accepted: true, invite_id: activated.invite_id, expires_at: activated.expires_at })
        : jsonResponse({ error: 'Invalid, expired, or already-used invite', reason: 'ALPHA_INVITE_REJECTED' }, 403);
    }
    if (path === '/admin/verified-product') {
      const authorized = await authorizeAdminSession(env, request.headers.get('x-scoop-admin-session') ?? '');
      if (!authorized.admin || !authorized.admin_id) return jsonResponse({ error: 'Unauthorized' }, 401);
      try {
        const body = await request.json() as Record<string, unknown>;
        const action = body.action === 'revoke' ? 'revoke' : 'verify';
        const platform = typeof body.platform === 'string' ? body.platform.slice(0, 40) : '';
        const contentRef = typeof body.content_ref === 'string' ? body.content_ref.slice(0, 180) : '';
        if (!platform || !contentRef) return jsonResponse({ error: 'Missing content identity' }, 400);
        if (action === 'revoke') {
          const productId = typeof body.product_id === 'string' ? body.product_id.slice(0, 160) : '';
          if (!productId) return jsonResponse({ error: 'Missing product id' }, 400);
          const revoked = await revokeAdminVerifiedMapping(env, { platform, content_ref: contentRef, product_id: productId });
          if (revoked) await auditAdminAction(env, authorized.admin_id!, 'verified_product_revoked', { platform, content_ref: contentRef, product_id: productId });
          return jsonResponse({ revoked });
        }
        const product = body.product && typeof body.product === 'object' && !Array.isArray(body.product) ? body.product as Record<string, unknown> : {};
        const description = normalizeObjectDescription(body.description);
        const timestampMs = typeof body.timestamp_ms === 'number' && Number.isFinite(body.timestamp_ms) && body.timestamp_ms >= 0 ? Math.round(body.timestamp_ms) : null;
        if (timestampMs === null) return jsonResponse({ error: 'Missing timestamp' }, 400);
        const destination = typeof product.destination === 'string' ? product.destination : '';
        try { new URL(destination); } catch { return jsonResponse({ error: 'Verified result needs a valid destination' }, 400); }
        const productId = typeof product.model === 'string' && product.model.trim()
          ? product.model.trim().slice(0, 160)
          : typeof product.id === 'string' ? product.id.trim().slice(0, 160) : '';
        const title = typeof product.title === 'string' ? product.title.trim().slice(0, 300) : '';
        if (!productId || !title) return jsonResponse({ error: 'Verified result is missing product identity' }, 400);
        const mapping: VerifiedProductMapping = {
          platform,
          content_ref: contentRef,
          scope: 'time_window',
          timestamp_start_ms: Math.max(0, timestampMs - 5000),
          timestamp_end_ms: timestampMs + 5000,
          object_type: (description.subcategory || description.category).slice(0, 100),
          brand: typeof product.brand === 'string' && product.brand.trim()
            ? product.brand.trim().slice(0, 120)
            : (description.brand_candidate ?? '').slice(0, 120),
          product_id: productId,
          title,
          destination,
          image_reference: typeof product.image_reference === 'string' && product.image_reference.trim()
            ? product.image_reference.trim().slice(0, 1200)
            : null,
          provider: typeof product.provider === 'string' && product.provider.trim()
            ? product.provider.trim().slice(0, 80)
            : typeof product.provenance === 'string' && product.provenance.trim()
              ? product.provenance.trim().slice(0, 80)
              : null,
          provenance: 'admin_verified',
        };
        const saved = await persistAdminVerifiedMapping(env, mapping);
        await auditAdminAction(env, authorized.admin_id!, 'verified_product_saved', { platform, content_ref: contentRef, product_id: productId, timestamp_ms: timestampMs });
        return jsonResponse({ accepted: true, mapping: saved });
      } catch (error) {
        logSafeError(error);
        return jsonResponse({ error: 'Could not verify exact product' }, 400);
      }
    }
    if (path === '/alpha/admin/invite') {
      const authorized = await authorizeAdminSession(env, request.headers.get('x-scoop-admin-session') ?? '');
      if (!authorized.admin || !authorized.admin_id) return jsonResponse({ error: 'Unauthorized' }, 401);
      const body = await request.json() as Record<string, unknown>;
      const inviteId = typeof body.invite_id === 'string' ? body.invite_id : '';
      const ttlDays = Number(body.ttl_days ?? 7);
      const maxInstalls = Number(body.max_installs ?? 2);
      try {
        const invite = await createAlphaInvite(env, inviteId, ttlDays, maxInstalls);
        await auditAdminAction(env, authorized.admin_id!, 'alpha_invite_created', { invite_id: inviteId, ttl_days: ttlDays, max_installs: maxInstalls });
        return jsonResponse({ ...invite, invite_url: `https://scoop.article6.org/alpha?code=${encodeURIComponent(invite.token)}` });
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : 'Could not create invite' }, 400);
      }
    }
    if (alphaInviteRequired(env)) {
      const allowed = await authorizeAlphaRequest(env, request);
      if (!allowed) return jsonResponse({ error: 'This Scoop alpha install needs a valid invite', reason: 'ALPHA_INVITE_REQUIRED', failure_state: 'ALPHA_INVITE_REQUIRED', retryable: false }, 401);
    }
    if (path === '/analyze-selection' || path === '/locate-selection') {
      let parsed: unknown;
      try { parsed = await readAnalysisBody(request); }
      catch { return jsonResponse({ error: 'Invalid or oversized analysis body' }, 400); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return jsonResponse({ error: 'dataUrl image is required' }, 400);
      const record = parsed as Record<string, unknown>;
      const dataUrl = record.dataUrl;
      if (typeof dataUrl !== 'string' || !parseSourceImage(dataUrl)) return jsonResponse({ error: 'dataUrl must be an image crop under 2 MB' }, 400);
      let point: SelectionPoint | undefined;
      if (path === '/locate-selection' || record.point !== undefined) {
        try { point = parseSelectionPoint(record.point); }
        catch { return jsonResponse({ error: 'A normalized click point is required' }, 400); }
        if (path === '/locate-selection' && !parseSourceImage(record.focusDataUrl)) return jsonResponse({ error: 'A bounded focus crop is required' }, 400);
      }
      const focusDataUrl = typeof record.focusDataUrl === 'string' && parseSourceImage(record.focusDataUrl)
        ? record.focusDataUrl
        : undefined;
      const timestamp = record.timestamp;
      if (timestamp !== undefined && (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0)) return jsonResponse({ error: 'Invalid primary timestamp' }, 400);
      let nearby;
      let primary;
      if (record.nearby_frames !== undefined) {
        try {
          if (typeof timestamp !== 'number') throw new Error('Primary timestamp required');
          nearby = parseEvidenceFrames(record.nearby_frames, timestamp);
          primary = normalizeObjectDescription(record.primary_description);
        } catch { return jsonResponse({ error: 'Invalid multi-frame evidence request' }, 400); }
      }
      type ActiveVisionProvider = OpenRouterVisionProvider | GeminiVisionProvider | GroqVisionProvider | CloudflareVisionProvider;
      type NamedVisionProvider = { name: VisionProviderName; provider: ActiveVisionProvider };
      const openrouter = env.OPENROUTER_API_KEY ? { name: 'openrouter' as const, provider: new OpenRouterVisionProvider(env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL) } : null;
      const gemini = env.GEMINI_API_KEY ? { name: 'gemini' as const, provider: new GeminiVisionProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL) } : null;
      const groq38 = env.GROQ_API_KEY ? { name: 'groq-3.8' as const, provider: new GroqVisionProvider(env.GROQ_API_KEY, 'qwen/qwen3.8-27b') } : null;
      const groq36 = env.GROQ_API_KEY ? { name: 'groq-3.6' as const, provider: new GroqVisionProvider(env.GROQ_API_KEY, 'qwen/qwen3.6-27b') } : null;
      const cloudflare = env.AI ? { name: 'cloudflare' as const, provider: new CloudflareVisionProvider(env.AI) } : null;
      const preferred: Array<NamedVisionProvider | null> = env.VISION_PROVIDER === 'openrouter'
        ? [openrouter, gemini, cloudflare, groq38, groq36]
        : env.VISION_PROVIDER === 'cloudflare'
          ? [cloudflare, openrouter, gemini, groq38, groq36]
          : env.VISION_PROVIDER === 'groq'
            ? [groq38, groq36, openrouter, gemini, cloudflare]
            : [gemini, openrouter, groq38, groq36, cloudflare];
      const visionProviders: NamedVisionProvider[] = preferred.filter((entry): entry is NamedVisionProvider => entry !== null);
      if (!visionProviders.length) {
        recordFailureState('vision', 'NO_CONFIGURED_PROVIDER', false);
        return jsonResponse({ error: 'Object analysis is temporarily unavailable', reason: 'NO_CONFIGURED_PROVIDER', failure_state: 'TEMPORARILY_UNAVAILABLE', retryable: false }, 503);
      }

      const visionRouting: Array<{ provider: VisionProviderName; status: 'SUCCESS' | 'FAILED' | 'SKIPPED'; reason?: string }> = [];
      const tryVision = async <T>(operation: (provider: ActiveVisionProvider) => Promise<T>) => {
        let lastError: unknown;
        let attempted = 0;
        for (const { name, provider } of visionProviders) {
          if (visionCircuitOpen(name)) {
            visionRouting.push({ provider: name, status: 'SKIPPED', reason: visionFailureReason.get(name) ?? 'COOLDOWN' });
            continue;
          }
          const maxAttempts = name === 'cloudflare' ? 2 : 1;
          for (let providerAttempt = 1; providerAttempt <= maxAttempts; providerAttempt++) {
            attempted++;
            try {
              const value = await operation(provider);
              markVisionSuccess(name);
              visionRouting.push({ provider: name, status: 'SUCCESS' });
              return value;
            } catch (error) {
              lastError = error;
              const reason = error instanceof VisionProviderError ? error.reason : 'PROVIDER_ERROR';
              visionRouting.push({ provider: name, status: 'FAILED', reason });
              logSafeError(error);
              const shouldRetryScout = name === 'cloudflare' && providerAttempt === 1 && reason === 'PROVIDER_ERROR';
              if (shouldRetryScout) continue;
              markVisionFailure(name, error);
              break;
            }
          }
        }
        if (!attempted) {
          const reasons = visionProviders.map(({ name }) => visionFailureReason.get(name)).filter(Boolean);
          const reason = reasons.includes('QUOTA_EXHAUSTED') ? 'QUOTA_EXHAUSTED' : 'PROVIDER_ERROR';
          throw new VisionProviderError(reason as any, 'All configured vision providers are temporarily cooling down.');
        }
        throw lastError ?? new Error('Vision providers unavailable');
      };

      if (point && path === '/locate-selection') {
        try {
          const localized = await tryVision((provider) => provider.locateSelection(dataUrl, record.focusDataUrl as string, point));
          return jsonResponse({ ...(localized as object), vision_routing: visionRouting });
        }
        catch (error) {
          const reason = error instanceof TargetLocalizationError ? error.reason : error instanceof VisionProviderError ? error.reason : 'localization_unavailable';
          recordFailureState('localization', String(reason), true);
          return jsonResponse({ error: 'Could not isolate the clicked object. Adjust the crop and try again.', reason, failure_state: 'UNSUPPORTED_SELECTION', retryable: true, vision_routing: visionRouting }, 422);
        }
      }
      if (nearby && primary && typeof timestamp === 'number') {
        try {
          const analyzed = await tryVision((provider) => analyzeWithNearbyFrames(provider, dataUrl, primary, timestamp, nearby, point));
          return jsonResponse({ ...(analyzed as object), vision_routing: visionRouting });
        }
        catch (error) {
          const reason = error instanceof VisionProviderError ? error.reason : 'PROVIDER_ERROR';
          recordFailureState('vision', String(reason), true);
          return jsonResponse({ error: 'Object analysis is temporarily unavailable', reason, failure_state: 'TEMPORARILY_UNAVAILABLE', retryable: true, vision_routing: visionRouting }, 502);
        }
      }
      let description;
      try {
        description = normalizeObjectDescription(await tryVision((provider) =>
          provider instanceof OpenRouterVisionProvider || provider instanceof GeminiVisionProvider
            ? provider.analyzeSelection(dataUrl, point, focusDataUrl)
            : provider.analyzeSelection(dataUrl, point)));
      }
      catch (error) {
        const reason = error instanceof VisionProviderError ? error.reason : 'PROVIDER_ERROR';
        recordFailureState('vision', String(reason), true);
        return jsonResponse({ error: 'Object analysis is temporarily unavailable', reason, failure_state: 'TEMPORARILY_UNAVAILABLE', retryable: true, vision_routing: visionRouting }, 502);
      }

      const textRecovery = { attempted: false, applied: false };
      if (shouldRunOcrRecovery(description)) {
        textRecovery.attempted = true;
        const recoveryImage = focusDataUrl || dataUrl;
        for (const { provider } of visionProviders) {
          if (!(provider instanceof OpenRouterVisionProvider || provider instanceof GeminiVisionProvider)) continue;
          try {
            const evidence = await provider.readTextEvidence(recoveryImage);
            const enriched = mergeOcrEvidence(description, evidence);
            textRecovery.applied = enriched.visible_text.length > description.visible_text.length
              || enriched.logos_markings.length > description.logos_markings.length;
            description = enriched;
            if (textRecovery.applied) break;
          } catch (error) {
            logSafeError(error);
          }
        }
      }

      const analyzed = timestamp === undefined ? description : mergeFrameEvidence(description, timestamp as number, []);
      return jsonResponse({ ...(analyzed as object), vision_routing: visionRouting });
    }
    if (path === '/commerce-click') {
      if (!env.ALPHA_ATTRIBUTION_SECRET) return jsonResponse({ error: 'Commerce attribution is not configured' }, 503);
      try {
        const body = await request.json() as Record<string, unknown>;
        const context = await verifyAttributionToken(env.ALPHA_ATTRIBUTION_SECRET, body?.attribution_token);
        recordCommerceClick(context);
        return jsonResponse({ accepted: true, click_ref: context.click_ref });
      } catch {
        return jsonResponse({ error: 'Invalid commerce attribution' }, 400);
      }
    }
    if (path === '/feedback') {
      try {
        const feedback = recordAlphaFeedback(await request.json());
        const persisted = await persistFeedback(env, feedback);
        return jsonResponse({ accepted: true, durable: Boolean(env.FEEDBACK_LEDGER), event_id: persisted.event_id });
      } catch (error) {
        logSafeError(error);
        return jsonResponse({ error: 'Invalid feedback' }, 400);
      }
    }
    if (path === '/feedback-report') {
      const authorized = await authorizeAdminSession(env, request.headers.get('x-scoop-admin-session') ?? '');
      if (!authorized.admin) return jsonResponse({ error: 'Unauthorized' }, 401);
      try {
        const body = await request.json().catch(() => ({})) as { session_id?: unknown };
        const sessionId = typeof body.session_id === 'string' ? body.session_id : null;
        return jsonResponse(await feedbackReport(env, sessionId));
      } catch (error) {
        logSafeError(error);
        return jsonResponse({ error: 'Feedback report unavailable' }, 500);
      }
    }
    if (path === '/resolve-products') {
      const installId = request.headers.get('x-scoop-install-id') ?? '';
      const benchmarkMode = env.BENCHMARK_MODE === 'true';
      const alphaGuardrailsEnabled = !benchmarkMode && Boolean(env.ALPHA_INSTALL_RATE_LIMITER || env.ALPHA_GLOBAL_RATE_LIMITER);
      if (alphaGuardrailsEnabled && !/^[a-f0-9-]{36}$/i.test(installId)) {
        return jsonResponse({ error: 'Missing alpha install identifier', reason: 'ALPHA_INSTALL_ID_REQUIRED' }, 400);
      }
      if (!benchmarkMode && env.ALPHA_INSTALL_RATE_LIMITER) {
        const { success } = await env.ALPHA_INSTALL_RATE_LIMITER.limit({ key: installId });
        if (!success) return jsonResponse({ error: 'Too many Scoop requests. Try again shortly.', reason: 'ALPHA_INSTALL_RATE_LIMIT', failure_state: 'TEMPORARILY_UNAVAILABLE', retryable: true }, 429);
      }
      if (!benchmarkMode && env.ALPHA_GLOBAL_RATE_LIMITER) {
        const { success } = await env.ALPHA_GLOBAL_RATE_LIMITER.limit({ key: 'alpha-global' });
        if (!success) return jsonResponse({ error: 'Scoop alpha is at its temporary usage limit. Try again shortly.', reason: 'ALPHA_GLOBAL_RATE_LIMIT', failure_state: 'TEMPORARILY_UNAVAILABLE', retryable: true }, 429);
      }
      const parsed: unknown = await request.json();
      const wrapped = Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'description' in parsed);
      const record = wrapped ? parsed as { description: unknown; context?: unknown; source_image?: unknown; multi_frame_available?: unknown; telemetry?: unknown; benchmark_visible_text_query_v2?: unknown; benchmark_marking_verify_v1?: unknown } : { description: parsed, context: undefined, source_image: undefined, multi_frame_available: undefined, telemetry: undefined, benchmark_visible_text_query_v2: undefined, benchmark_marking_verify_v1: undefined };
      let alphaTelemetry = null;
      try { alphaTelemetry = normalizeAlphaTelemetry(record.telemetry); }
      catch { return jsonResponse({ error: 'Invalid telemetry envelope' }, 400); }
      const rawDescription = record.description as Record<string, unknown> | null;
      const sourceImage = parseSourceImage(record.source_image);
      if (record.source_image != null && !sourceImage) return jsonResponse({ error: 'source_image must be a base64 JPEG, PNG, WebP or GIF crop under 2 MB' }, 400);
      const description = normalizeObjectDescription(record.description);
      const context = normalizeContext(record.context);
      const contentRef = context?.content_ref ?? null;
      const durableMappings = await durableVerifiedMappings(env, context?.platform ?? null, contentRef).catch(() => []);
      const verifiedMapping = lookupVerifiedProductMapping({
        rawRegistry: env.VERIFIED_PRODUCT_MAPPINGS_JSON,
        mappings: durableMappings,
        allowTestFixtures: benchmarkMode || env.VERIFIED_PRODUCT_TEST_MODE === 'true',
        platform: context?.platform ?? null,
        contentRef,
        timestampMs: context?.timestamp_ms ?? null,
        description,
      });
      if (verifiedMapping) {
        const started = Date.now();
        const configuredProviders = commerceProviders(env);
        const refreshed = configuredProviders.length
          ? await refreshVerifiedOffers(configuredProviders, verifiedMapping)
          : { products: [verifiedMappingProduct(verifiedMapping)], providers_used: [], commerce_calls: {}, provider_retrieval_ms: 0 };
        const total_ms = Date.now() - started;
        recordAlphaScoop({
          telemetry: alphaTelemetry,
          state: 'RESULTS',
          totalMs: total_ms,
          providersUsed: refreshed.providers_used,
          resultRows: refreshed.products.map((product) => ({ id: product.id, result_class: product.result_class })),
          verificationUsage: undefined,
          commerceCalls: refreshed.commerce_calls,
          visionUsage: rawDescription?.provider_usage,
        });
        return jsonResponse({
          query: {
            query: verifiedMapping.title,
            category: verifiedMapping.object_type,
            subcategory: verifiedMapping.object_type,
            brand: verifiedMapping.brand || null,
            model: verifiedMapping.product_id || null,
            attributes: [],
          },
          products: refreshed.products,
          state: 'RESULTS',
          providers_configured: configuredProviders.map(({ name }) => name),
          providers_used: refreshed.providers_used,
          attempts: refreshed.providers_used.length,
          verification: { retrieved: refreshed.products.length, metadata_prefiltered: 0, light_escalations: 0, compared: 0, image_failures: 0, image_failure_reasons: {}, rejected: 0, contradictions: {} },
          cost_usage: { commerce_calls: refreshed.commerce_calls, verification_usage: { provider: 'none', model: 'none', requests: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: 0 } },
          verified_mapping: { hit: true, provenance: verifiedMapping.provenance, product_id: verifiedMapping.product_id },
          latency_ms: total_ms,
          timing: { provider_retrieval_ms: refreshed.provider_retrieval_ms, candidate_verification_ms: 0, candidate_image_fetch_ms: 0, candidate_model_verification_ms: 0, verification_batches: [], total_ms },
        });
      }
      const providers = commerceProviders(env);
      if (!providers.length) {
        recordFailureState('commerce', 'NO_CONFIGURED_PROVIDER', false);
        return jsonResponse({ error: 'Shopping sources are temporarily unavailable', reason: 'NO_CONFIGURED_PROVIDER', failure_state: 'TEMPORARILY_UNAVAILABLE', retryable: false }, 503);
      }
      const creatorId = creatorForContent(env.ALPHA_CREATOR_CONTENT_MAP, contentRef);
      const affiliateClickRef = env.ALPHA_ATTRIBUTION_SECRET && creatorId && contentRef && alphaTelemetry
        ? await makeCommerceClickRef({
            secret: env.ALPHA_ATTRIBUTION_SECRET,
            creator_id: creatorId,
            content_ref: contentRef,
            event_id: alphaTelemetry.event_id,
          })
        : null;
      const visibleTextQueryV2 = env.VISIBLE_TEXT_QUERY_V2 === 'true' || record.benchmark_visible_text_query_v2 === true;
      const queries = buildProductQueryVariants(description, context, visibleTextQueryV2).map((query) => affiliateClickRef
        ? { ...query, affiliate_reference_id: affiliateClickRef }
        : query);
      let routing: Parameters<typeof resolveProducts>[7];
      const jevMode = env.JEV_MODE === 'off' || env.JEV_MODE === 'router' || env.JEV_MODE === 'fabric'
        ? env.JEV_MODE
        : env.JEV_DECISION_ROUTER === 'true' ? 'router' : 'off';
      if (jevMode !== 'off') {
        const jevBinding = resolveJevBinding(env);
        if (jevBinding) {
          const input = routerInput(description, Boolean(record.multi_frame_available), providers.length);
          const routed = jevMode === 'fabric'
            ? await routeWithJevFabric(input, jevBinding)
            : await routeWithJev(input, jevBinding);
          const broadSearchOnMiss = jevMode === 'fabric'
            && 'broad_search_on_miss' in routed.telemetry
            && routed.telemetry.broad_search_on_miss === true;
          routing = {
            ...routed.decision,
            telemetry: routed.telemetry,
            ...(broadSearchOnMiss ? { broad_search_on_miss: true } : {}),
          };
        }
      }
      const routingActive = Boolean(routing && !routing.telemetry.failed);
      const routedProviders = routingActive && routing?.commerce_action === 'SKIP' ? [] : providers;
      const routedQueries = !routingActive
        ? queries
        : routing?.commerce_action === 'SKIP'
          ? queries.slice(0, 1)
          : queries;
      const started = Date.now();
      const markingVerifyV1 = record.benchmark_marking_verify_v1 === true;
      const resolved = await resolveProducts(routedProviders, routedQueries, description, env, context, sourceImage, compareCandidateImages, routing, markingVerifyV1);
      const feedbackEvidenceKey = evidenceFingerprint(description);
      let feedbackLearning = { penalized: 0, suppressed: 0 };
      if (env.FEEDBACK_LEDGER && resolved.products.length) {
        try {
          const penalties = await feedbackPenalties(env, feedbackEvidenceKey, resolved.products);
          const adjusted = applyFeedbackPenalties(resolved.products, penalties);
          resolved.products = adjusted.products;
          feedbackLearning = { penalized: adjusted.penalized, suppressed: adjusted.suppressed };
        } catch (error) {
          logSafeError(error);
        }
      }
      const total_ms = Date.now() - started;
      const failureState = resolved.state === 'TEMPORARILY_UNAVAILABLE' ? 'TEMPORARILY_UNAVAILABLE' : resolved.state === 'NO_RESULTS' ? 'NO_RESULTS' : undefined;
      if (resolved.state === 'TEMPORARILY_UNAVAILABLE') recordFailureState('commerce', 'PROVIDER_UNAVAILABLE', true);
      else if (resolved.state === 'NO_RESULTS') recordFailureState('commerce', 'NO_RESULTS', false);
      recordAlphaScoop({
        telemetry: alphaTelemetry,
        state: resolved.state,
        totalMs: total_ms,
        providersUsed: resolved.providers_used,
        resultRows: resolved.products.map((product) => ({ id: product.id, result_class: product.result_class })),
        verificationUsage: resolved.cost_usage?.verification_usage,
        commerceCalls: resolved.cost_usage?.commerce_calls,
        visionUsage: rawDescription?.provider_usage,
        failureState,
      });
      if (alphaTelemetry && env.FEEDBACK_LEDGER && resolved.products.length) {
        const feedbackWrites = resolved.products.map((product) => persistFeedbackContext(env, {
          event_id: alphaTelemetry!.event_id,
          session_id: alphaTelemetry!.session_id,
          result_id: product.id,
          candidate_key: feedbackCandidateKey(product),
          provider: product.provider || product.provenance || 'unknown',
          provenance: product.provenance || 'unknown',
          result_class: product.result_class,
          evidence_key: feedbackEvidenceKey,
          query: resolved.query.query,
          category: resolved.query.category,
          subcategory: resolved.query.subcategory,
          brand: resolved.query.brand,
          model: resolved.query.model,
          vision_model: env.OPENROUTER_MODEL || env.GEMINI_MODEL || env.VISION_PROVIDER || null,
          ranking_policy: FEEDBACK_RANKING_POLICY,
          created_at: new Date().toISOString(),
        }));
        const writeTask = Promise.all(feedbackWrites).then(() => undefined).catch((error) => { logSafeError(error); });
        if (ctx?.waitUntil) ctx.waitUntil(writeTask);
        else await writeTask;
      }
      let attributedProducts = resolved.products;
      if (env.ALPHA_ATTRIBUTION_SECRET && creatorId && contentRef && alphaTelemetry) {
        attributedProducts = await Promise.all(resolved.products.map(async (product) => {
          const merchant = product.provider || product.provenance || 'unknown';
          const attribution = await makeAttribution({
            secret: env.ALPHA_ATTRIBUTION_SECRET as string,
            creator_id: creatorId,
            content_ref: contentRef,
            event_id: alphaTelemetry!.event_id,
            result_id: product.id,
            merchant,
            affiliate_network: product.provider === 'ebay' && env.EBAY_AFFILIATE_CAMPAIGN_ID ? 'ebay-epn' : null,
            click_ref: affiliateClickRef,
          });
          return { ...product, attribution_token: attribution.attribution_token, click_ref: attribution.click_ref };
        }));
      }
      return jsonResponse({ ...resolved, products: attributedProducts, feedback_learning: feedbackLearning, latency_ms: total_ms, timing: { ...resolved.timing, total_ms },
        ...(resolved.state === 'TEMPORARILY_UNAVAILABLE' ? { failure_state: 'TEMPORARILY_UNAVAILABLE', retryable: true } :
          resolved.state === 'NO_RESULTS' ? { failure_state: 'NO_RESULTS', retryable: false } : {}) });
    }
    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) {
    logSafeError(error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown API error' }, 500);
  }
} };
