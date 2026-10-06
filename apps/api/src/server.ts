import { GeminiVisionProvider, VisionProviderError } from './gemini-vision.js';
import { GroqVisionProvider } from './groq-vision.js';
import { CloudflareVisionProvider, type CloudflareVisionBinding } from './cloudflare-vision.js';
import { OpenRouterVisionProvider, DEFAULT_OPENROUTER_MODEL } from './openrouter-vision.js';
import { analyzeWithNearbyFrames, mergeFrameEvidence, parseEvidenceFrames } from './multi-frame-evidence.js';
import { normalizeObjectDescription } from './types.js';
import { mergeOcrEvidence, shouldRunOcrRecovery } from './ocr-evidence.js';
import { parseSelectionPoint, TargetLocalizationError, type SelectionPoint } from './selection-target.js';
import { CommerceNoResultsError, buildProductQueryVariants, type CommerceProvider, type ProductCandidate, type ProductContext, type ProductQuery } from './commerce.js';
import { classifyCanonicalRelationship, highConfidenceMetadataContradiction, verifyCandidate, rankVerified } from './candidate-verification.js';
import { canonical } from './verification-evidence.js';
import { candidateKey, compareCandidateImages, parseSourceImage, imageRequestBudget } from './candidate-images.js';
import type { ImageComparison } from './verification-evidence.js';
import { EbayAuth } from './ebay-auth.js';
import { EbayCommerceProvider, ebayItemIdForLiveLookup } from './ebay-commerce.js';
import { resolveEbayCredentials, type EbayCredentials } from './ebay-credentials.js';
import { EtsyCommerceProvider } from './etsy-commerce.js';
import { resolveEtsyCredentials, type EtsyCredentials } from './etsy-credentials.js';
import { SerpApiCommerceProvider } from './serpapi-commerce.js';
import { BraveCommerceProvider } from './brave-commerce.js';
import { resolveBraveCredentials } from './brave-credentials.js';
import { routeWithJev, routerInput, type CanonicalRetrievalAction, type JevRouterTelemetry } from './jev-router.js';
import { routeWithJevFabric } from './jev-fabric.js';
import type { WorkersAiBinding } from './jev.js';
import { resolveJevBinding } from './jev-binding.js';
import { normalizeAlphaTelemetry, recordAlphaFeedback, recordAlphaScoop } from './alpha-telemetry.js';
import { applyFeedbackPenalties, evidenceFingerprint, feedbackCandidateKey, feedbackFamily, feedbackPenalties, feedbackReport, feedbackReviewItem, persistFeedback, persistFeedbackContext, resolveFeedbackReview, FEEDBACK_RANKING_POLICY, type DurableObjectNamespaceLike } from './feedback-ledger.js';
export { FeedbackLedger } from './feedback-ledger.js';
import { persistAlphaLearning } from './alpha-learning.js';
import { creatorForContent, makeAttribution, makeCommerceClickRef, recordCommerceClick, verifyAttributionToken } from './commerce-attribution.js';
import { activateAlphaInvite, alphaInviteRequired, authorizeAlphaRequest, createAlphaInvite, type DurableObjectNamespaceLike as AlphaAccessNamespaceLike } from './alpha-access.js';
import { lookupVerifiedProductMapping, verifiedMappingProduct, type VerifiedProductMapping } from './verified-product-mapping.js';
import { backfillLegacyAdminCanonicalMappings, consolidateCanonicalProducts, durableCanonicalCandidates, durableCanonicalProductIdentity, durableVerifiedMappings, persistAdminVerifiedMapping, persistCanonicalProductIdentity, persistTrustedVpmObservation, revokeAdminVerifiedMapping, type VerifiedProductLedgerNamespaceLike } from './verified-product-ledger.js';
import { distinctiveTextSameVideoReuse, eligibleSameVideoCanonicalCandidates, exactModelSameVideoReuse, selectSameVideoVisualWinner, verifiedProductMemoryCandidates, identityWithTrustedVpmObservations, type SameVideoCanonicalCandidate, type SameVideoReuseDecision } from './same-video-verified-reuse.js';
import { canonicalIdentityHasMerchantOffer, canonicalProductIdentity, type CanonicalProductIdentity } from './canonical-product-memory.js';
import { confirmCrossVideoVisual, crossVideoCanonicalCandidates, type CrossVideoReuseDecision } from './cross-video-verified-reuse.js';
import { authorizeAdminSession, createAdminInvite, createBootstrapAdmin, redeemAdminInvite, auditAdminAction, type AdminAccessNamespaceLike } from './admin-access.js';
import { fetchProductPageMetadata } from './product-page-enrichment.js';
import { recoverVerifiedProductImage } from './verified-image-recovery.js';
import { ALPHA_VERIFIED_PRODUCT_SEEDS, alphaVerifiedCanonicalRowsForContent, alphaVerifiedCanonicalIdentitiesExcludingContent } from './alpha-verified-product-seeds.js';
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
  VISUAL_PRODUCT_INDEX?: string;
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
  for (const product of products) {
    // Merchant item IDs are stable even when affiliate/canonical URLs differ.
    // Prefer the freshest row with price data when duplicate offers are present.
    const provider = (product.provider || product.provenance?.split(':')[0] || 'unknown').trim().toLowerCase();
    const itemId = product.id?.trim();
    let destinationKey = product.destination ?? '';
    if (destinationKey) {
      try {
        const url = new URL(destinationKey);
        url.search = '';
        url.hash = '';
        destinationKey = url.toString().replace(/\/$/, '');
      } catch {}
    }
    const key = itemId ? `${provider}:${itemId}` : destinationKey || `${product.provenance}:unknown`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(product);
    if (out.length >= 8) break;
  }
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

function verifiedIdentityKey(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function verifiedSourceProviderName(value: string | null | undefined, destination?: string | null): string {
  const raw = (value ?? '').trim().toLowerCase();
  const root = raw.split(':', 1)[0];
  if (root === 'ebay' || root === 'etsy' || root === 'serpapi' || root === 'brave') return root;

  // Older admin-verified rows can carry internal provenance (for example
  // "admin_verified") instead of the merchant provider. Recover the merchant
  // from the verified destination so exact-item hydration still runs.
  if (destination) {
    try {
      const host = new URL(destination).hostname.toLowerCase().replace(/^www\./, '');
      if (host === 'ebay.com' || host.endsWith('.ebay.com')) return 'ebay';
      if (host === 'etsy.com' || host.endsWith('.etsy.com')) return 'etsy';
    } catch {}
  }
  return '';
}

function verifiedOfferHasExactIdentity(mapping: VerifiedProductMapping, product: ProductCandidate): boolean {
  const expectedModel = verifiedIdentityKey(mapping.product_id);
  if (!expectedModel) return false;
  if (product.model && verifiedIdentityKey(product.model) === expectedModel) return true;
  if (product.id && verifiedIdentityKey(product.id) === expectedModel) return true;
  if (product.destination && mapping.destination) {
    try {
      const actual = new URL(product.destination);
      const expected = new URL(mapping.destination);
      if (actual.origin === expected.origin && actual.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '')) return true;
    } catch {}
  }
  return false;
}

const verifiedSourceImageCache = new Map<string, { image: string | null; expires_at: number }>();

function safeVerifiedSourceUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host)
      || /^192\.168\./.test(host) || /^169\.254\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '::1') return null;
    return url;
  } catch {
    return null;
  }
}

function sourceImageFromHtml(html: string, base: URL): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const property = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (property !== 'og:image' && property !== 'og:image:secure_url' && property !== 'twitter:image') continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!content) continue;
    try {
      const image = new URL(content.replace(/&amp;/g, '&'), base);
      if (image.protocol === 'https:' || image.protocol === 'http:') return image.toString();
    } catch {}
  }

  // Some storefronts do not expose social image metadata early in the response.
  // Fall back to the first real product image in the page rather than leaving a
  // verified product visually blank. This remains source-backed, not hardcoded.
  const imageTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const preferred = imageTags.find((tag) =>
    /cdn\.shopify\.com/i.test(tag)
    && /(?:product|shirt|dress|leeward|steel blue|tonal texture)/i.test(tag),
  ) ?? imageTags.find((tag) => /cdn\.shopify\.com/i.test(tag));
  if (preferred) {
    const src = preferred.match(/\b(?:src|data-src)\s*=\s*["']([^"']+)["']/i)?.[1]
      ?? preferred.match(/\bsrcset\s*=\s*["']([^"' ,]+)/i)?.[1];
    if (src) {
      try {
        const image = new URL(src.replace(/&amp;/g, '&'), base);
        if (image.protocol === 'https:' || image.protocol === 'http:') return image.toString();
      } catch {}
    }
  }
  return null;
}

async function sourceImageForVerifiedMapping(mapping: VerifiedProductMapping): Promise<string | null> {
  if (mapping.image_reference) return mapping.image_reference;
  const source = safeVerifiedSourceUrl(mapping.destination);
  if (!source) return null;
  const cached = verifiedSourceImageCache.get(source.toString());
  if (cached && cached.expires_at > Date.now()) return cached.image;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(source.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    if (!response.ok || !(response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
      verifiedSourceImageCache.set(source.toString(), { image: null, expires_at: Date.now() + 5 * 60_000 });
      return null;
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let html = '';
    let bytes = 0;
    while (bytes < 300_000) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (/<meta\b[^>]*(?:og:image|twitter:image)/i.test(html) || /<img\b[^>]*cdn\.shopify\.com/i.test(html)) break;
    }
    try { await reader.cancel(); } catch {}
    html += decoder.decode();
    const image = sourceImageFromHtml(html, new URL(response.url || source.toString()));
    verifiedSourceImageCache.set(source.toString(), { image, expires_at: Date.now() + (image ? 30 * 60_000 : 5 * 60_000) });
    return image;
  } catch {
    verifiedSourceImageCache.set(source.toString(), { image: null, expires_at: Date.now() + 5 * 60_000 });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshVerifiedOffers(
  providers: NamedCommerceProvider[],
  mapping: VerifiedProductMapping,
  visual?: {
    env: Env;
    description: ReturnType<typeof normalizeObjectDescription>;
    context?: ProductContext;
    sourceImage?: ReturnType<typeof parseSourceImage>;
  },
): Promise<{
  products: ProductCandidate[];
  providers_used: string[];
  commerce_calls: Record<string, number>;
  provider_retrieval_ms: number;
  verification_usage?: {
    provider: string;
    model: string;
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd?: number;
  };
  visual_compared?: number;
}> {
  const started = Date.now();
  const sourceProviderName = verifiedSourceProviderName(mapping.provider, mapping.destination);
  const sourceProviders = sourceProviderName
    ? providers.filter(({ name }) => name.toLowerCase() === sourceProviderName)
    : [];

  const providersUsed: string[] = [];
  const commerceCalls: Record<string, number> = {};

  let exactSource: ProductCandidate | null = null;
  let canonicalModel: string | null = null;

  const exactLookupSource = sourceProviders.find(({ provider }) =>
    typeof (provider as CommerceProvider & { getItemById?: unknown }).getItemById === 'function',
  );
  if (exactLookupSource) {
    const query: ProductQuery = {
      query: mapping.product_id || mapping.title,
      category: mapping.object_type,
      subcategory: mapping.object_type,
      brand: mapping.brand || null,
      model: mapping.product_id || null,
      attributes: [],
    };
    providersUsed.push(exactLookupSource.name);
    commerceCalls[exactLookupSource.name] = (commerceCalls[exactLookupSource.name] ?? 0) + 1;
    const exactLookup = (exactLookupSource.provider as CommerceProvider & {
      getItemById(itemId: string, query: ProductQuery): Promise<ProductCandidate | null>;
    }).getItemById.bind(exactLookupSource.provider);

    // Older promoted mappings may store a canonical SKU in product_id rather than
    // the merchant listing ID. Recover the eBay item ID from the saved URL first.
    let lookupItemId = mapping.product_id;
    if (exactLookupSource.name === 'ebay') {
      lookupItemId = ebayItemIdForLiveLookup(mapping.product_id, mapping.destination);
    }
    exactSource = await exactLookup(lookupItemId, query).catch(() => null);
    if (exactSource?.model) canonicalModel = exactSource.model;
  }

  const merchantMetadata = exactSource?.price
    ? null
    : await fetchProductPageMetadata(mapping.destination).catch(() => null);
  const sourceImage = exactSource?.image_reference
    ?? mapping.image_reference
    ?? merchantMetadata?.image_reference
    ?? await sourceImageForVerifiedMapping(mapping)
    ?? await recoverVerifiedProductImage(visual?.env.BRAVE_SEARCH_API_KEY, mapping);
  const hydratedMapping: VerifiedProductMapping = {
    ...mapping,
    ...(sourceImage ? { image_reference: sourceImage } : {}),
    ...(merchantMetadata?.price ? { price: merchantMetadata.price } : {}),
    ...(merchantMetadata?.currency ? { currency: merchantMetadata.currency } : {}),
  };

  // Older Product Memory rows may predate cached commerce metadata. As soon as a
  // later refresh successfully recovers image/price, persist it so future hits do
  // not depend on the merchant page being fetchable again.
  const metadataImproved = Boolean(
    (hydratedMapping.image_reference && hydratedMapping.image_reference !== mapping.image_reference)
    || (hydratedMapping.price && hydratedMapping.price !== mapping.price)
    || (hydratedMapping.currency && hydratedMapping.currency !== mapping.currency)
  );
  if (metadataImproved && visual?.env && mapping.provenance === 'admin_verified') {
    await persistAdminVerifiedMapping(visual.env, hydratedMapping).catch(() => hydratedMapping);
  }

  const fallback = verifiedMappingProduct(hydratedMapping);

  const identityKey = `verified:${verifiedIdentityKey(canonicalModel) || verifiedIdentityKey(mapping.product_id)}`;
  const makeExact = (product: ProductCandidate, reason = `${mapping.provenance} product identity; same verified SKU/model`): ProductCandidate => ({
    ...product,
    result_class: 'EXACT',
    relationship: 'EXACT',
    provenance: mapping.provenance,
    provider: product.provider || mapping.provider || undefined,
    identity_key: identityKey,
    verification_status: product.verification_status ?? 'metadata_only',
    verification_score: 100,
    verification_reasons: [...(product.verification_reasons ?? []), reason],
  });

  const canonicalProduct = exactSource
    ? makeExact({
        ...exactSource,
        title: mapping.title || exactSource.title,
        brand: mapping.brand || exactSource.brand,
        image_reference: exactSource.image_reference || sourceImage,
      })
    : fallback;

  if (!providers.length) {
    return { products: [canonicalProduct], providers_used: providersUsed, commerce_calls: commerceCalls, provider_retrieval_ms: Date.now() - started };
  }

  // A canonical product is the anchor. Search all configured commerce providers
  // with product-level identity evidence, not the original merchant item id.
  const searchIdentity = canonicalModel || mapping.product_id || null;
  const searchQuery: ProductQuery = {
    query: searchIdentity || mapping.title,
    category: mapping.object_type,
    subcategory: mapping.object_type,
    brand: mapping.brand || null,
    model: searchIdentity,
    attributes: [],
  };

  const batches = await Promise.all(providers.map(async ({ name, provider }) => {
    providersUsed.push(name);
    commerceCalls[name] = (commerceCalls[name] ?? 0) + 1;
    try {
      return await provider.search(searchQuery);
    } catch (error) {
      if (!(error instanceof CommerceNoResultsError)) logSafeError(error);
      return [];
    }
  }));

  const candidates = dedupeProducts(batches.flat());
  const expectedSku = verifiedIdentityKey(canonicalModel || mapping.product_id);
  const metadataExact: ProductCandidate[] = [];
  const needsVisual: ProductCandidate[] = [];

  for (const product of candidates) {
    if (exactSource?.id && product.id === exactSource.id) {
      metadataExact.push(makeExact(product));
      continue;
    }
    if (product.model && expectedSku && verifiedIdentityKey(product.model) === expectedSku) {
      metadataExact.push(makeExact(product));
      continue;
    }
    if (verifiedOfferHasExactIdentity(mapping, product)) {
      metadataExact.push(makeExact(product));
      continue;
    }
    if (!product.image_reference) continue;
    if (visual && !highConfidenceMetadataContradiction(visual.description, product)) needsVisual.push(product);
  }

  let visualExact: ProductCandidate[] = [];
  const offerComparisonsForRelationship = new Map<string, ImageComparison | undefined>();
  let verificationUsage: {
    provider: string;
    model: string;
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd?: number;
  } | undefined;
  let visualCompared = 0;

  if (visual?.sourceImage && needsVisual.length) {
    const useOpenRouter = visual.env.VISION_PROVIDER === 'openrouter' && Boolean(visual.env.OPENROUTER_API_KEY);
    const key = useOpenRouter ? visual.env.OPENROUTER_API_KEY : visual.env.GEMINI_API_KEY;
    if (key) {
      const model = useOpenRouter
        ? (visual.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL)
        : (visual.env.GEMINI_MODEL || 'gemini-3.5-flash-lite');
      const images = await compareCandidateImages(
        key,
        model,
        visual.sourceImage,
        visual.description,
        needsVisual.slice(0, 8),
        visual.context,
        imageRequestBudget(),
        { provider: useOpenRouter ? 'openrouter' : 'gemini' },
      ).catch(() => null);

      if (images) {
        verificationUsage = images.usage;
        visualCompared = images.compared;
        const comparedProducts = needsVisual.slice(0, 8);
        const offerComparisons = new Map<string, ImageComparison | undefined>(
          comparedProducts.map((product) => [product.id, images.comparisons.get(candidateKey(product))]),
        );
        for (const [id, comparison] of offerComparisons) offerComparisonsForRelationship.set(id, comparison);
        visualExact = comparedProducts.flatMap((product) => {
          const comparison = offerComparisons.get(product.id);
          if (!comparison || !visual) return [];
          const relationship = classifyCanonicalRelationship(visual.description, product, comparison);
          if (relationship !== 'EXACT') return [];
          return [makeExact({
            ...product,
            verification_status: 'multimodal',
            verification_image_similarity: comparison.similarity,
            verification_image_confidence: comparison.confidence,
          }, 'visual match to the verified canonical product')];
        });
      }
    }
  }

  const exactOfferIds = new Set(visualExact.map((product) => product.id));
  const visualAlternatives = needsVisual.slice(0, 8).flatMap((product): ProductCandidate[] => {
    if (exactOfferIds.has(product.id)) return [];
    const comparison = offerComparisonsForRelationship.get(product.id);
    if (!comparison || !visual) return [];
    const relationship = classifyCanonicalRelationship(visual.description, product, comparison);
    return [{
      ...product,
      result_class: 'SIMILAR',
      relationship,
      verification_status: 'multimodal',
      verification_image_similarity: comparison.similarity,
      verification_image_confidence: comparison.confidence,
      verification_reasons: [
        ...(product.verification_reasons ?? []),
        relationship === 'SIMILAR'
          ? 'Same product idea/design family, but canonical identity was not confirmed'
          : 'Related product; canonical design identity was not confirmed',
      ],
    }];
  });

  // Canonical memory is also a durable pool of merchant offers that already
  // earned Exact. Read those refs back into results so a provider miss or a
  // previously deleted timestamp mapping cannot strand a verified offer.
  let rememberedExact: ProductCandidate[] = [];
  if (mapping.canonical_key && visual?.env) {
    const remembered = await durableCanonicalProductIdentity(visual.env, mapping.canonical_key).catch(() => null);
    if (remembered) {
      rememberedExact = remembered.merchant_refs
        .filter((ref) => Boolean(ref.destination))
        .map((ref) => makeExact({
          id: ref.item_id || ref.destination,
          title: remembered.title,
          brand: remembered.brand,
          model: remembered.model,
          category: remembered.object_type,
          image_reference: ref.image_reference,
          provenance: remembered.provenance,
          provider: ref.source || undefined,
          destination: ref.destination,
          price: null,
          currency: null,
          result_class: 'EXACT',
          metadata: {
            ...(remembered.brand ? { brand: remembered.brand } : {}),
            ...(remembered.model ? { model: remembered.model } : {}),
            category: remembered.object_type,
            ...(remembered.color ? { color: remembered.color } : {}),
            ...(remembered.material ? { material: remembered.material } : {}),
          },
        }, 'previously verified merchant offer from canonical memory'));
    }
  }

  // Provider rows carry current price/currency. Put them ahead of remembered
  // canonical rows so dedupe keeps live commerce data for the same seller/item.
  // Hydrate every remembered eBay Exact from Browse before rendering it.
  // Canonical memory intentionally does not own volatile price data, so a
  // remembered row must never be the final source of truth for price/currency.
  if (mapping.canonical_key && visual?.env && rememberedExact.length) {
    const ebay = providers.find(({ name, provider }) =>
      name === 'ebay' && typeof (provider as CommerceProvider & { getItemById?: unknown }).getItemById === 'function',
    );
    if (ebay) {
      const getItemById = (ebay.provider as CommerceProvider & {
        getItemById(itemId: string, query: ProductQuery): Promise<ProductCandidate | null>;
      }).getItemById.bind(ebay.provider);
      const query: ProductQuery = {
        query: mapping.title,
        category: mapping.object_type,
        subcategory: mapping.object_type,
        brand: mapping.brand || null,
        model: canonicalModel,
        attributes: [],
      };
      rememberedExact = await Promise.all(rememberedExact.map(async (product) => {
        const provider = verifiedSourceProviderName(product.provider || product.provenance, product.destination);
        if (provider !== 'ebay') return product;
        const itemId = ebayItemIdForLiveLookup(product.id, product.destination);
        if (!itemId) return product;
        commerceCalls.ebay = (commerceCalls.ebay ?? 0) + 1;
        if (!providersUsed.includes('ebay')) providersUsed.push('ebay');
        const live = await getItemById(itemId, query).catch(() => null);
        return live ? makeExact({
          ...product,
          ...live,
          title: product.title || live.title,
          brand: product.brand || live.brand,
          image_reference: live.image_reference || product.image_reference,
        }, 'live eBay offer for previously verified canonical product') : product;
      }));
    }
  }

  // One canonical identity must render as one Exact product card.
  // Merchant rows and remembered offers are evidence/offers for that identity,
  // not additional Exact products. Preserve their freshest image/price on the
  // canonical card, then keep genuinely different products as Similar/Related.
  const exactEvidence = [...metadataExact, ...visualExact, ...rememberedExact];
  const pricedExact = exactEvidence.find((product) => Boolean(product.price));
  const imagedExact = exactEvidence.find((product) => Boolean(product.image_reference));
  const canonicalExact: ProductCandidate = {
    ...canonicalProduct,
    image_reference: canonicalProduct.image_reference
      || mapping.image_reference
      || imagedExact?.image_reference
      || sourceImage
      || null,
    price: canonicalProduct.price ?? pricedExact?.price ?? null,
    currency: canonicalProduct.currency ?? pricedExact?.currency ?? null,
  };

  // If exact-SKU commerce search recovered richer metadata than the original
  // merchant page fetch, write it back to Product Memory as well.
  if (visual?.env && mapping.provenance === 'admin_verified') {
    const enrichedFromOffers: VerifiedProductMapping = {
      ...mapping,
      ...(canonicalExact.image_reference ? { image_reference: canonicalExact.image_reference } : {}),
      ...(canonicalExact.price ? { price: canonicalExact.price } : {}),
      ...(canonicalExact.currency ? { currency: canonicalExact.currency } : {}),
    };
    const offerMetadataImproved = Boolean(
      (enrichedFromOffers.image_reference && enrichedFromOffers.image_reference !== mapping.image_reference)
      || (enrichedFromOffers.price && enrichedFromOffers.price !== mapping.price)
      || (enrichedFromOffers.currency && enrichedFromOffers.currency !== mapping.currency)
    );
    if (offerMetadataImproved) {
      await persistAdminVerifiedMapping(visual.env, enrichedFromOffers).catch(() => enrichedFromOffers);
    }
  }

  const exactProducts = dedupeProducts([canonicalExact, ...visualAlternatives]).slice(0, 8);

  // Teach canonical memory which merchant offers have now independently passed.
  if (mapping.canonical_key && visual?.env && visualExact.length) {
    const existing = await durableCanonicalProductIdentity(visual.env, mapping.canonical_key).catch(() => null);
    if (existing) {
      const learned: CanonicalProductIdentity = {
        ...existing,
        verified_at: new Date().toISOString(),
        merchant_refs: visualExact.map((product) => ({
          source: product.provider || product.provenance || null,
          item_id: product.id || null,
          destination: product.destination ?? '',
          image_reference: product.image_reference ?? null,
        })).filter((ref) => Boolean(ref.destination)),
      };
      await persistCanonicalProductIdentity(visual.env, learned).catch(() => null);
    }
  }

  return {
    products: exactProducts,
    providers_used: [...new Set(providersUsed)],
    commerce_calls: commerceCalls,
    provider_retrieval_ms: Date.now() - started,
    ...(verificationUsage ? { verification_usage: verificationUsage } : {}),
    visual_compared: visualCompared,
  };
}

type SameVideoVisualCheck = {
  decision: SameVideoReuseDecision;
  compared: number;
  failures: number;
  failure_reasons: Record<string, number>;
  usage?: {
    provider: string;
    model: string;
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd?: number;
  };
  timing?: {
    image_fetch_ms: number;
    model_ms: number;
    total_ms: number;
    batches: Array<{
      batch_index: number;
      candidates: number;
      images_loaded: number;
      comparisons: number;
      image_fetch_ms: number;
      model_ms: number;
      total_ms: number;
    }>;
  };
};

async function confirmSameVideoReuseWithImage(
  env: Env,
  description: ReturnType<typeof normalizeObjectDescription>,
  context: ProductContext | undefined,
  sourceImage: ReturnType<typeof parseSourceImage>,
  candidates: SameVideoCanonicalCandidate[],
): Promise<SameVideoVisualCheck> {
  const noDecision: SameVideoReuseDecision = {
    mapping: null,
    canonical_key: null,
    confidence: 0,
    reason: 'no_candidate',
  };
  const empty = { decision: noDecision, compared: 0, failures: 0, failure_reasons: {} };

  const exactModel = exactModelSameVideoReuse({ description, candidates });
  if (exactModel.mapping) return { ...empty, decision: exactModel };

  // A unique promoted track with the same distinctive visible phrase is already
  // strong product identity evidence. Reconnect before expensive image comparison.
  const distinctiveText = distinctiveTextSameVideoReuse({ description, candidates });
  if (distinctiveText.mapping) return { ...empty, decision: distinctiveText };

  const eligible = eligibleSameVideoCanonicalCandidates({ description, candidates });
  const vpm = verifiedProductMemoryCandidates({ description, candidates });
  // Explicit VPM tracks are the authoritative memory set. Historical canonical
  // mappings remain a legacy fallback only when this video has no compatible VPM.
  const visualCandidates = vpm.length ? vpm : eligible;
  if (!visualCandidates.length || !sourceImage) {
    return { ...empty, decision: { ...noDecision, reason: visualCandidates.length ? 'visual_unavailable' : 'no_candidate' } };
  }

  const useOpenRouter = env.VISION_PROVIDER === 'openrouter' && Boolean(env.OPENROUTER_API_KEY);
  const key = useOpenRouter ? env.OPENROUTER_API_KEY : env.GEMINI_API_KEY;
  if (!key) return { ...empty, decision: { ...noDecision, reason: 'visual_unavailable' } };
  const model = useOpenRouter ? (env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL) : (env.GEMINI_MODEL || 'gemini-3.5-flash-lite');

  const providers = commerceProviders(env);
  const rows: Array<{ identity: CanonicalProductIdentity; product: ProductCandidate }> = [];
  for (const candidate of visualCandidates) {
    let identity = candidate.identity;
    let merchantRef = identity.merchant_refs.find((ref) => Boolean(ref.image_reference && ref.destination));

    if (!merchantRef?.image_reference) {
      const refreshed = await refreshVerifiedOffers(providers, candidate.mapping).catch(() => null);
      const hydrated = refreshed?.products.find((product) => Boolean(product.image_reference && product.destination)) ?? null;
      const hydratedDestination = hydrated?.destination ?? null;
      if (hydrated?.image_reference && hydratedDestination) {
        const hydratedIdentity: CanonicalProductIdentity = {
          ...identity,
          merchant_refs: [{
            source: hydrated.provider || hydrated.provenance || null,
            item_id: hydrated.id || candidate.mapping.product_id,
            destination: hydratedDestination,
            image_reference: hydrated.image_reference,
          }],
        };
        identity = await persistCanonicalProductIdentity(env, hydratedIdentity).catch(() => hydratedIdentity);
        merchantRef = identity.merchant_refs.find((ref) => Boolean(ref.image_reference && ref.destination))
          ?? hydratedIdentity.merchant_refs[0];
      }
    }

    if (!merchantRef?.image_reference) continue;

    rows.push({
      identity,
      product: {
        id: identity.canonical_key,
        title: identity.title,
        brand: identity.brand,
        model: identity.model,
        category: identity.object_type,
        image_reference: merchantRef.image_reference,
        provenance: 'canonical_verified',
        destination: merchantRef.destination,
        price: null,
        currency: null,
        result_class: 'SIMILAR',
        metadata: {
          ...(identity.brand ? { brand: identity.brand } : {}),
          ...(identity.model ? { model: identity.model } : {}),
          category: identity.object_type,
          ...(identity.color ? { color: identity.color } : {}),
          ...(identity.material ? { material: identity.material } : {}),
        },
      },
    });
  }

  if (!rows.length) return { ...empty, decision: { ...noDecision, reason: 'visual_unavailable' } };

  const images = await compareCandidateImages(
    key,
    model,
    sourceImage,
    description,
    rows.map((row) => row.product),
    context,
    imageRequestBudget(),
    { provider: useOpenRouter ? 'openrouter' : 'gemini' },
  ).catch(() => null);

  if (!images) {
    return {
      ...empty,
      decision: { ...noDecision, reason: 'visual_unavailable' },
      failures: 1,
      failure_reasons: { visual_check_failed: 1 },
    };
  }

  const comparisons = new Map<string, ImageComparison>();
  for (const row of rows) {
    const comparison = images.comparisons.get(candidateKey(row.product));
    if (comparison) comparisons.set(row.identity.canonical_key, comparison);
  }

  return {
    decision: selectSameVideoVisualWinner({ candidates: visualCandidates, comparisons }),
    compared: images.compared,
    failures: images.failures,
    failure_reasons: images.failure_reasons ?? {},
    usage: images.usage,
    timing: images.timing,
  };
}


type CrossVideoVisualCheck = {
  decision: CrossVideoReuseDecision;
  compared: number;
  failures: number;
  failure_reasons: Record<string, number>;
  usage?: {
    provider: string;
    model: string;
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd?: number;
  };
  timing?: {
    image_fetch_ms: number;
    model_ms: number;
    total_ms: number;
    batches: Array<{
      batch_index: number;
      candidates: number;
      images_loaded: number;
      comparisons: number;
      image_fetch_ms: number;
      model_ms: number;
      total_ms: number;
    }>;
  };
};

async function confirmCrossVideoReuseWithImage(
  env: Env,
  description: ReturnType<typeof normalizeObjectDescription>,
  context: ProductContext | undefined,
  sourceImage: ReturnType<typeof parseSourceImage>,
  excludeCanonicalKeys: Set<string> = new Set(),
  retrievalAction: CanonicalRetrievalAction = 'HYBRID',
): Promise<CrossVideoVisualCheck> {
  const noDecision: CrossVideoReuseDecision = {
    identity: null,
    canonical_key: null,
    confidence: 0,
    reason: 'no_candidate',
  };
  const empty = { decision: noDecision, compared: 0, failures: 0, failure_reasons: {} };
  if (!sourceImage) return empty;

  const paths = retrievalAction === 'SKIP'
    ? []
    : retrievalAction === 'HYBRID'
      ? ['MODEL', 'TEXT', 'STRUCTURED'] as const
      : [retrievalAction] as const;
  if (!paths.length) return empty;

  const durableIdentities = (await durableCanonicalCandidates(env, {
    paths: [...paths],
    brand: description.brand_candidate,
    model: description.model_candidate,
    object_type: description.subcategory || description.category,
    color: description.color,
    visible_text: description.visible_text,
    logos_markings: description.logos_markings,
    limit: 24,
  }).catch(() => []))
    .filter((identity) => !excludeCanonicalKeys.has(identity.canonical_key));

  // During alpha, verified creator/admin roster entries must also be reusable
  // across videos. They are candidates only: cross-video Exact still requires
  // the existing strict image verification below.
  const seedIdentities = alphaVerifiedCanonicalIdentitiesExcludingContent(
    context?.platform ?? null,
    context?.content_ref ?? null,
  ).filter((identity) => !excludeCanonicalKeys.has(identity.canonical_key));
  const identityMap = new Map<string, CanonicalProductIdentity>();
  for (const identity of [...durableIdentities, ...seedIdentities]) {
    if (!identityMap.has(identity.canonical_key)) identityMap.set(identity.canonical_key, identity);
  }
  const identities = [...identityMap.values()];
  const candidates = crossVideoCanonicalCandidates({ description, identities });
  if (!candidates.length) return empty;

  const rows = candidates.slice(0, 8).flatMap((candidate) => {
    const identity = candidate.identity;
    if (!identity) return [];
    const merchant = identity.merchant_refs.find((ref) => Boolean(ref.image_reference && ref.destination));
    if (!merchant?.image_reference) return [];
    return [{
      candidate,
      product: {
        id: identity.canonical_key,
        title: identity.title,
        brand: identity.brand,
        model: identity.model,
        category: identity.object_type,
        image_reference: merchant.image_reference,
        provenance: 'canonical_verified',
        destination: merchant.destination,
        price: null,
        currency: null,
        result_class: 'SIMILAR',
      } as ProductCandidate,
    }];
  });
  if (!rows.length) return { ...empty, decision: { ...noDecision, reason: 'visual_rejected' } };

  const useOpenRouter = env.VISION_PROVIDER === 'openrouter' && Boolean(env.OPENROUTER_API_KEY);
  const key = useOpenRouter ? env.OPENROUTER_API_KEY : env.GEMINI_API_KEY;
  if (!key) return empty;
  const model = useOpenRouter
    ? (env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL)
    : (env.GEMINI_MODEL || 'gemini-3.5-flash-lite');
  const images = await compareCandidateImages(
    key,
    model,
    sourceImage,
    description,
    rows.map((row) => row.product),
    context,
    imageRequestBudget(),
    { provider: useOpenRouter ? 'openrouter' : 'gemini' },
  ).catch(() => null);
  if (!images) {
    return {
      ...empty,
      decision: { ...noDecision, reason: 'visual_rejected' },
      failures: 1,
      failure_reasons: { visual_check_failed: 1 },
    };
  }

  const comparisons = new Map<string, ImageComparison>();
  for (const row of rows) {
    const comparison = images.comparisons.get(candidateKey(row.product));
    if (comparison) comparisons.set(row.candidate.canonical_key!, comparison);
  }
  return {
    decision: confirmCrossVideoVisual(rows.map((row) => row.candidate), comparisons),
    compared: images.compared,
    failures: images.failures,
    failure_reasons: images.failure_reasons ?? {},
    usage: images.usage,
    timing: images.timing,
  };
}

function crossVideoMapping(
  identity: CanonicalProductIdentity,
  context: ProductContext | undefined,
): VerifiedProductMapping | null {
  if (!context?.platform || !context.content_ref) return null;
  const merchant = identity.merchant_refs.find((ref) => Boolean(ref.destination));
  if (!merchant) return null;
  const timestamp = context.timestamp_ms ?? 0;
  return {
    platform: context.platform,
    content_ref: context.content_ref,
    scope: 'time_window',
    timestamp_start_ms: Math.max(0, timestamp - 5000),
    timestamp_end_ms: timestamp + 5000,
    object_type: identity.object_type,
    brand: identity.brand ?? '',
    product_id: merchant.item_id || identity.model || identity.canonical_key,
    title: identity.title,
    destination: merchant.destination,
    image_reference: merchant.image_reference,
    provider: merchant.source,
    canonical_key: identity.canonical_key,
    track_id: identity.canonical_key,
    provenance: identity.provenance,
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
  if (path === '/alpha/waitlist') {
    try {
      const body = await request.text();
      const upstream = await fetch('https://article6.org/api/scoop-waitlist', {
        method: 'POST',
        headers: { 'content-type': request.headers.get('content-type') || 'application/json' },
        body,
        redirect: 'follow',
      });
      const text = await upstream.text();
      return new Response(text || null, {
        status: upstream.status,
        headers: {
          ...corsHeaders,
          'Content-Type': upstream.headers.get('content-type') || 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      logSafeError(error);
      return jsonResponse({ error: 'Could not join the Founding 100. Please try again.' }, 502);
    }
  }
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
        const action = body.action === 'revoke' || body.action === 'demote'
          ? 'revoke'
          : body.action === 'producer_seed'
            ? 'producer_seed'
            : 'verify';
        const platform = typeof body.platform === 'string' ? body.platform.slice(0, 40) : '';
        const contentRef = typeof body.content_ref === 'string' ? body.content_ref.slice(0, 180) : '';
        if (!platform || !contentRef) return jsonResponse({ error: 'Missing content identity' }, 400);

        // Generic creator/producer SKU ingestion. This is the durable path for
        // partner-supplied product truth and does not require a code change per video.
        if (action === 'producer_seed') {
          const destinationInput = typeof body.destination === 'string' ? body.destination.trim() : '';
          try { new URL(destinationInput); } catch { return jsonResponse({ error: 'Producer mapping needs a valid product URL' }, 400); }

          const objectType = typeof body.object_type === 'string' ? body.object_type.trim().slice(0, 100) : '';
          if (!objectType) return jsonResponse({ error: 'Producer mapping needs object_type' }, 400);

          const sourceMetadata = await fetchProductPageMetadata(destinationInput);
          const destination = (sourceMetadata.canonical_url || destinationInput).slice(0, 1200);
          const suppliedSku = typeof body.product_id === 'string' && body.product_id.trim()
            ? body.product_id.trim()
            : typeof body.sku === 'string' ? body.sku.trim() : '';
          const productId = (suppliedSku || sourceMetadata.sku || '').slice(0, 160);
          if (!productId) return jsonResponse({ error: 'Producer mapping needs a SKU/product_id' }, 400);

          const suppliedTitle = typeof body.title === 'string' ? body.title.trim() : '';
          const title = (sourceMetadata.title || suppliedTitle || productId).slice(0, 300);
          const suppliedImage = typeof body.image_reference === 'string' ? body.image_reference.trim() : '';
          const imageReference = (sourceMetadata.image_reference || suppliedImage || '').slice(0, 1200) || null;
          const brand = typeof body.brand === 'string' ? body.brand.trim().slice(0, 120) : '';
          const requestedProvenance = body.provenance;
          const provenance: VerifiedProductMapping['provenance'] =
            requestedProvenance === 'creator_verified' || requestedProvenance === 'brand_verified'
              ? requestedProvenance
              : 'admin_verified';

          const mapping: VerifiedProductMapping = {
            platform,
            content_ref: contentRef,
            scope: 'entire_video',
            object_type: objectType,
            brand,
            product_id: productId,
            title,
            destination,
            image_reference: imageReference,
            provider: verifiedSourceProviderName(null, destination) || null,
            provenance,
          };

          const saved = await persistAdminVerifiedMapping(env, mapping);
          await auditAdminAction(env, authorized.admin_id!, 'producer_verified_product_saved', {
            platform,
            content_ref: contentRef,
            product_id: productId,
            provenance,
          });
          return jsonResponse({ accepted: true, mapping: saved });
        }

        if (action === 'revoke') {
          const product = body.product && typeof body.product === 'object' && !Array.isArray(body.product) ? body.product as Record<string, unknown> : {};
          const canonicalKey = typeof body.canonical_key === 'string' ? body.canonical_key.slice(0, 220) : '';
          const productId = typeof body.product_id === 'string' && body.product_id.trim()
            ? body.product_id.trim().slice(0, 160)
            : typeof product.model === 'string' && product.model.trim()
              ? product.model.trim().slice(0, 160)
              : typeof product.id === 'string' ? product.id.trim().slice(0, 160) : '';
          if (!productId && !canonicalKey) return jsonResponse({ error: 'Missing product identity' }, 400);
          const revoked = await revokeAdminVerifiedMapping(env, {
            platform,
            content_ref: contentRef,
            ...(productId ? { product_id: productId } : {}),
            ...(canonicalKey ? { canonical_key: canonicalKey } : {}),
          });
          if (revoked) await auditAdminAction(env, authorized.admin_id!, 'verified_product_revoked', {
            platform,
            content_ref: contentRef,
            ...(productId ? { product_id: productId } : {}),
            ...(canonicalKey ? { canonical_key: canonicalKey } : {}),
          });
          return jsonResponse({ revoked });
        }
        const product = body.product && typeof body.product === 'object' && !Array.isArray(body.product) ? body.product as Record<string, unknown> : {};
        const description = normalizeObjectDescription(body.description);
        const timestampMs = typeof body.timestamp_ms === 'number' && Number.isFinite(body.timestamp_ms) && body.timestamp_ms >= 0 ? Math.round(body.timestamp_ms) : null;
        if (timestampMs === null) return jsonResponse({ error: 'Missing timestamp' }, 400);
        const destinationInput = typeof product.destination === 'string' ? product.destination.trim() : '';
        try { new URL(destinationInput); } catch { return jsonResponse({ error: 'Verified result needs a valid destination' }, 400); }

        // Enrich once when the verified mapping is created so repeated Scoops reuse
        // canonical product metadata instead of scraping the merchant page every time.
        // Source-page metadata wins; supplied fields remain a graceful fallback.
        const sourceMetadata = await fetchProductPageMetadata(destinationInput);
        const destination = (sourceMetadata.canonical_url || destinationInput).slice(0, 1200);
        const suppliedProductId = typeof product.model === 'string' && product.model.trim()
          ? product.model.trim()
          : typeof product.id === 'string' ? product.id.trim() : '';
        const productId = (suppliedProductId || sourceMetadata.sku || '').slice(0, 160);
        const suppliedTitle = typeof product.title === 'string' ? product.title.trim() : '';
        const title = (sourceMetadata.title || suppliedTitle).slice(0, 300);
        const suppliedImage = typeof product.image_reference === 'string' && product.image_reference.trim()
          ? product.image_reference.trim()
          : '';
        const imageReference = (sourceMetadata.image_reference || suppliedImage || '').slice(0, 1200) || null;
        if (!productId || !title) return jsonResponse({ error: 'Verified result is missing product identity' }, 400);
        const mappingBase: VerifiedProductMapping = {
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
          image_reference: imageReference,
          provider: typeof product.provider === 'string' && product.provider.trim()
            ? verifiedSourceProviderName(product.provider, destination).slice(0, 80) || null
            : typeof product.provenance === 'string' && product.provenance.trim()
              ? verifiedSourceProviderName(product.provenance, destination).slice(0, 80) || null
              : verifiedSourceProviderName(null, destination) || null,
          provenance: 'admin_verified',
        };
        const canonicalKeyHint = typeof body.canonical_key_hint === 'string' ? body.canonical_key_hint.slice(0, 220) : '';
        const sameVideoMappings = await durableVerifiedMappings(env, platform, contentRef);
        const hintedMapping = sameVideoMappings.find((entry) => entry.canonical_key === canonicalKeyHint);
        const hintedIdentity = hintedMapping && canonicalKeyHint
          ? await durableCanonicalProductIdentity(env, canonicalKeyHint)
          : null;

        const incomingOfferRef = {
          source: mappingBase.provider ?? 'unknown',
          item_id: typeof product.id === 'string' ? product.id.trim().slice(0, 180) || null : null,
          destination: mappingBase.destination,
          image_reference: mappingBase.image_reference ?? null,
        };
        const canonicalKeys = [...new Set(sameVideoMappings
          .map((entry) => entry.canonical_key)
          .filter((key): key is string => Boolean(key)))];
        const sameVideoIdentities = (await Promise.all(canonicalKeys.map((key) =>
          durableCanonicalProductIdentity(env, key).catch(() => null))))
          .filter((identity): identity is CanonicalProductIdentity => Boolean(identity));
        const offerMatchedIdentities = hintedIdentity ? [] : sameVideoIdentities.filter((identity) =>
          canonicalIdentityHasMerchantOffer(identity, incomingOfferRef));
        const rememberedOfferIdentity = offerMatchedIdentities.length === 1 ? offerMatchedIdentities[0] : null;

        let canonical: CanonicalProductIdentity;
        const existingIdentity = hintedIdentity ?? rememberedOfferIdentity;
        if (existingIdentity) {
          canonical = await persistCanonicalProductIdentity(env, {
            ...existingIdentity,
            verified_at: new Date().toISOString(),
            merchant_refs: [incomingOfferRef],
          });
        } else {
          const identity = canonicalProductIdentity({
            mapping: mappingBase,
            model: typeof product.model === 'string' ? product.model : null,
            merchantItemId: typeof product.id === 'string' ? product.id : null,
            visibleText: description.visible_text,
            color: description.color,
            material: description.material,
            styleAttributes: description.style_attributes,
            logosMarkings: description.logos_markings,
            distinctiveFeatures: description.distinctive_features,
            shapeSilhouette: description.shape_silhouette,
          });
          canonical = await persistCanonicalProductIdentity(env, identity);
        }
        // Promotion anchors a persistent product track for this video. The original
        // time window remains useful as an observation, but later frames can rejoin
        // this track through the canonical identity instead of inheriting Exact by time.
        const mapping: VerifiedProductMapping = {
          ...mappingBase,
          canonical_key: canonical.canonical_key,
          track_id: canonical.canonical_key,
          trusted_observations: [{
            observed_at: new Date().toISOString(),
            timestamp_ms: timestampMs,
            reason: 'promotion',
            confidence: 1,
            visible_text: description.visible_text,
            logos_markings: description.logos_markings,
            distinctive_features: description.distinctive_features,
            shape_silhouette: description.shape_silhouette,
            style_attributes: description.style_attributes,
            color: description.color || null,
            material: description.material || null,
          }],
        };
        const saved = await persistAdminVerifiedMapping(env, mapping);
        await auditAdminAction(env, authorized.admin_id!, 'verified_product_saved', {
          platform,
          content_ref: contentRef,
          product_id: productId,
          canonical_key: canonical.canonical_key,
          timestamp_ms: timestampMs,
        });
        return jsonResponse({ accepted: true, mapping: saved, canonical_key: canonical.canonical_key });
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
    if (path === '/feedback-review') {
      const authorized = await authorizeAdminSession(env, request.headers.get('x-scoop-admin-session') ?? '');
      if (!authorized.admin || !authorized.admin_id) return jsonResponse({ error: 'Unauthorized' }, 401);
      try {
        const body = await request.json() as Record<string, unknown>;
        const eventId = typeof body.event_id === 'string' ? body.event_id.slice(0, 160) : '';
        const resultId = typeof body.result_id === 'string' ? body.result_id.slice(0, 180) : '';
        const action = body.action;
        if (!eventId || !resultId || (action !== 'dismiss' && action !== 'hard_negative' && action !== 'verify_product')) {
          return jsonResponse({ error: 'Invalid review action' }, 400);
        }
        const item = await feedbackReviewItem(env, eventId, resultId);
        if (!item) return jsonResponse({ error: 'Review item not found' }, 404);

        let canonicalKey: string | null = null;
        if (action === 'verify_product') {
          const product = body.product && typeof body.product === 'object' && !Array.isArray(body.product)
            ? body.product as Record<string, unknown>
            : {};
          const destinationInput = typeof product.destination === 'string' ? product.destination.trim() : '';
          try { new URL(destinationInput); } catch { return jsonResponse({ error: 'Verified product needs a valid destination' }, 400); }
          const sourceMetadata = await fetchProductPageMetadata(destinationInput);
          const destination = (sourceMetadata.canonical_url || destinationInput).slice(0, 1200);
          const suppliedId = typeof product.model === 'string' && product.model.trim()
            ? product.model.trim()
            : typeof product.id === 'string' ? product.id.trim() : '';
          const productId = (suppliedId || sourceMetadata.sku || '').slice(0, 160);
          if (!productId) return jsonResponse({ error: 'Verified product needs a SKU/model' }, 400);
          const title = (sourceMetadata.title || (typeof product.title === 'string' ? product.title.trim() : '') || productId).slice(0, 300);
          const imageReference = (sourceMetadata.image_reference || (typeof product.image_reference === 'string' ? product.image_reference.trim() : '') || '').slice(0, 1200) || null;
          const brand = (typeof product.brand === 'string' ? product.brand.trim() : item.brand || '').slice(0, 120);
          const hasSourceContext = Boolean(item.platform && item.content_ref);
          const timestampMs = item.timestamp_ms != null && Number.isFinite(item.timestamp_ms)
            ? Math.max(0, Math.round(item.timestamp_ms))
            : null;
          const mapping: VerifiedProductMapping = {
            platform: hasSourceContext ? item.platform! : 'alpha-learning',
            content_ref: hasSourceContext ? item.content_ref! : eventId,
            scope: hasSourceContext && timestampMs != null ? 'time_window' : 'entire_video',
            ...(hasSourceContext && timestampMs != null ? {
              timestamp_start_ms: Math.max(0, timestampMs - 5000),
              timestamp_end_ms: timestampMs + 5000,
            } : {}),
            object_type: item.subcategory || item.category,
            brand,
            product_id: productId,
            title,
            destination,
            image_reference: imageReference,
            price: sourceMetadata.price,
            currency: sourceMetadata.currency,
            provider: verifiedSourceProviderName(null, destination) || null,
            provenance: 'admin_verified',
          };
          const canonical = canonicalProductIdentity({
            mapping,
            model: productId,
            merchantItemId: productId,
            visibleText: item.visible_text,
            color: item.color,
            material: item.material,
            styleAttributes: item.style_attributes,
            logosMarkings: item.logos_markings,
            distinctiveFeatures: item.distinctive_features,
            shapeSilhouette: item.shape_silhouette,
          });
          const saved = await persistCanonicalProductIdentity(env, canonical);
          canonicalKey = saved.canonical_key;
          await persistAdminVerifiedMapping(env, {
            ...mapping,
            canonical_key: saved.canonical_key,
            track_id: saved.canonical_key,
            trusted_observations: [{
              observed_at: new Date().toISOString(),
              timestamp_ms: timestampMs,
              reason: 'promotion',
              confidence: 1,
              visible_text: item.visible_text,
              logos_markings: item.logos_markings,
              distinctive_features: item.distinctive_features,
              shape_silhouette: item.shape_silhouette,
              style_attributes: item.style_attributes,
              color: item.color,
              material: item.material,
            }],
          });
        }

        await resolveFeedbackReview(env, {
          event_id: eventId,
          result_id: resultId,
          action,
          canonical_key: canonicalKey,
          note: typeof body.note === 'string' ? body.note : null,
        });
        await auditAdminAction(env, authorized.admin_id, 'feedback_review_resolved', {
          event_id: eventId,
          result_id: resultId,
          action,
          ...(canonicalKey ? { canonical_key: canonicalKey } : {}),
        });
        return jsonResponse({ accepted: true, action, canonical_key: canonicalKey });
      } catch (error) {
        logSafeError(error);
        return jsonResponse({ error: 'Could not resolve feedback review' }, 400);
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
      const record = wrapped ? parsed as { description: unknown; context?: unknown; source_image?: unknown; multi_frame_available?: unknown; telemetry?: unknown; benchmark_visible_text_query_v2?: unknown; benchmark_marking_verify_v1?: unknown; vpm_observation_mode?: unknown } : { description: parsed, context: undefined, source_image: undefined, multi_frame_available: undefined, telemetry: undefined, benchmark_visible_text_query_v2: undefined, benchmark_marking_verify_v1: undefined, vpm_observation_mode: undefined };
      let alphaTelemetry = null;
      try { alphaTelemetry = normalizeAlphaTelemetry(record.telemetry); }
      catch { return jsonResponse({ error: 'Invalid telemetry envelope' }, 400); }
      const rawDescription = record.description as Record<string, unknown> | null;
      const sourceImage = parseSourceImage(record.source_image);
      if (record.source_image != null && !sourceImage) return jsonResponse({ error: 'source_image must be a base64 JPEG, PNG, WebP or GIF crop under 2 MB' }, 400);
      const description = normalizeObjectDescription(record.description);
      const context = normalizeContext(record.context);
      const contentRef = context?.content_ref ?? null;

      // Route once, before canonical-memory lookup, then reuse the same Jev
      // decision for commerce and verification. Jev chooses retrieval paths;
      // indexed storage and the verifier remain authoritative.
      let routing: (Parameters<typeof resolveProducts>[7] & { canonical_retrieval_action?: CanonicalRetrievalAction }) | undefined;
      const jevMode = env.JEV_MODE === 'off' || env.JEV_MODE === 'router' || env.JEV_MODE === 'fabric'
        ? env.JEV_MODE
        : env.JEV_DECISION_ROUTER === 'true' ? 'router' : 'off';
      if (jevMode !== 'off') {
        const jevBinding = resolveJevBinding(env);
        if (jevBinding) {
          const input = routerInput(description, Boolean(record.multi_frame_available), commerceProviders(env).length);
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
      const canonicalRetrievalAction: CanonicalRetrievalAction =
        routing && !routing.telemetry.failed
          ? routing.canonical_retrieval_action ?? 'HYBRID'
          : 'HYBRID';

      const verifiedResolutionStarted = Date.now();
      let durableMappings = await durableVerifiedMappings(env, context?.platform ?? null, contentRef).catch(() => []);
      if (durableMappings.some((mapping) => mapping.provenance === 'admin_verified' && !mapping.canonical_key)) {
        durableMappings = await backfillLegacyAdminCanonicalMappings(env, durableMappings).catch(() => durableMappings);
      }
      let verifiedMapping = lookupVerifiedProductMapping({
        rawRegistry: env.VERIFIED_PRODUCT_MAPPINGS_JSON,
        // Durable/admin mappings win. Alpha seed data is only the fallback until
        // a creator/brand-confirmed mapping is persisted for the same content.
        mappings: [...durableMappings, ...ALPHA_VERIFIED_PRODUCT_SEEDS],
        allowTestFixtures: benchmarkMode || env.VERIFIED_PRODUCT_TEST_MODE === 'true',
        platform: context?.platform ?? null,
        contentRef,
        timestampMs: context?.timestamp_ms ?? null,
        description,
      });
      let sameVideoReuse: SameVideoReuseDecision = {
        mapping: null,
        canonical_key: null,
        confidence: 0,
        reason: 'no_candidate',
      };
      let sameVideoVisualCheck: SameVideoVisualCheck = {
        decision: sameVideoReuse,
        compared: 0,
        failures: 0,
        failure_reasons: {},
      };
      let crossVideoReuse: CrossVideoReuseDecision = {
        identity: null,
        canonical_key: null,
        confidence: 0,
        reason: 'no_candidate',
      };
      let crossVideoVisualCheck: CrossVideoVisualCheck = {
        decision: crossVideoReuse,
        compared: 0,
        failures: 0,
        failure_reasons: {},
      };
      const alphaCanonicalRows = alphaVerifiedCanonicalRowsForContent(
        context?.platform ?? null,
        contentRef,
      );
      if (!verifiedMapping && (durableMappings.length || alphaCanonicalRows.length)) {
        const canonicalMappings = durableMappings.filter((mapping) => Boolean(mapping.canonical_key));
        const durableCanonicalRows = (await Promise.all(canonicalMappings.map(async (mapping) => {
          const identity = mapping.canonical_key
            ? await durableCanonicalProductIdentity(env, mapping.canonical_key).catch(() => null)
            : null;
          return identity ? { mapping, identity: identityWithTrustedVpmObservations(identity, mapping) } : null;
        }))).filter((row): row is NonNullable<typeof row> => Boolean(row));

        // Durable rows win when the same canonical product has already been
        // persisted. Alpha roster rows fill the gap so a multi-product creator
        // video can be resolved from its verified product list without manual
        // timestamps. Visual verification still decides which product is on screen.
        const canonicalRowMap = new Map<string, SameVideoCanonicalCandidate>();
        for (const row of [...durableCanonicalRows, ...alphaCanonicalRows]) {
          if (!canonicalRowMap.has(row.identity.canonical_key)) canonicalRowMap.set(row.identity.canonical_key, row);
        }
        const canonicalRows = [...canonicalRowMap.values()];

        sameVideoVisualCheck = await confirmSameVideoReuseWithImage(
          env,
          description,
          context,
          sourceImage,
          canonicalRows,
        );
        sameVideoReuse = sameVideoVisualCheck.decision;
        if (sameVideoReuse.mapping) {
          verifiedMapping = sameVideoReuse.mapping;
          const trustedReason = sameVideoReuse.reason === 'model_exact'
            || sameVideoReuse.reason === 'distinctive_text_exact'
            || sameVideoReuse.reason === 'visual_confirmed';
          if (trustedReason && verifiedMapping.canonical_key && context?.platform && contentRef) {
            const learned = await persistTrustedVpmObservation(env, {
              platform: context.platform,
              content_ref: contentRef,
              canonical_key: verifiedMapping.canonical_key,
              observation: {
                observed_at: new Date().toISOString(),
                timestamp_ms: context.timestamp_ms ?? null,
                reason: sameVideoReuse.reason as 'model_exact' | 'distinctive_text_exact' | 'visual_confirmed',
                confidence: sameVideoReuse.confidence,
                visible_text: description.visible_text,
                logos_markings: description.logos_markings,
                distinctive_features: description.distinctive_features,
                shape_silhouette: description.shape_silhouette,
                style_attributes: description.style_attributes,
                color: description.color || null,
                material: description.material || null,
              },
            }).catch(() => null);
            if (learned) verifiedMapping = learned;
          }
        }
      }
      if (!verifiedMapping) {
        const sameVideoCanonicalKeys = new Set(
          durableMappings.map((mapping) => mapping.canonical_key).filter((key): key is string => Boolean(key)),
        );
        crossVideoVisualCheck = await confirmCrossVideoReuseWithImage(
          env,
          description,
          context,
          sourceImage,
          sameVideoCanonicalKeys,
          canonicalRetrievalAction,
        );
        crossVideoReuse = crossVideoVisualCheck.decision;
        if (crossVideoReuse.identity && (crossVideoReuse.equivalent_canonical_keys?.length ?? 0) > 1) {
          const consolidated = await consolidateCanonicalProducts(
            env,
            crossVideoReuse.equivalent_canonical_keys!,
          ).catch(() => null);
          if (consolidated) {
            crossVideoReuse = {
              ...crossVideoReuse,
              identity: consolidated,
              canonical_key: consolidated.canonical_key,
            };
          }
        }
        if (crossVideoReuse.identity) {
          const reused = crossVideoMapping(crossVideoReuse.identity, context);
          if (reused) {
            verifiedMapping = reused;
            if (reused.provenance === 'admin_verified') {
              verifiedMapping = await persistAdminVerifiedMapping(env, reused).catch(() => reused);
            }
          }
        }
      }

      if (verifiedMapping) {
        const configuredProviders = commerceProviders(env);
        const refreshed = await refreshVerifiedOffers(configuredProviders, verifiedMapping, {
          env,
          description,
          context,
          sourceImage,
        });
        const total_ms = Date.now() - verifiedResolutionStarted;
        recordAlphaScoop({
          telemetry: alphaTelemetry,
          state: 'RESULTS',
          totalMs: total_ms,
          providersUsed: refreshed.providers_used,
          resultRows: refreshed.products.map((product) => ({ id: product.id, result_class: product.result_class })),
          verificationUsage: sameVideoVisualCheck.usage ?? crossVideoVisualCheck.usage,
          commerceCalls: refreshed.commerce_calls,
          visionUsage: rawDescription?.provider_usage,
        });
        const verifiedLearning = persistAlphaLearning({
          env,
          telemetry: alphaTelemetry,
          description,
          state: 'RESULTS',
          total_ms,
          products: refreshed.products,
          query: {
            query: verifiedMapping.title,
            category: verifiedMapping.object_type,
            subcategory: verifiedMapping.object_type,
            brand: verifiedMapping.brand || null,
            model: verifiedMapping.product_id || null,
            attributes: [],
          },
          verification_usage: sameVideoVisualCheck.usage ?? crossVideoVisualCheck.usage,
          commerce_calls: refreshed.commerce_calls,
          verified_canonical_key: verifiedMapping.canonical_key ?? null,
          context: {
            platform: context?.platform ?? null,
            content_ref: contentRef,
            timestamp_ms: context?.timestamp_ms ?? null,
          },
        }).catch((error) => { logSafeError(error); });
        if (ctx?.waitUntil) ctx.waitUntil(verifiedLearning);
        else await verifiedLearning;
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
          verification: {
            retrieved: refreshed.products.length,
            metadata_prefiltered: 0,
            light_escalations: 0,
            compared: sameVideoVisualCheck.compared + crossVideoVisualCheck.compared,
            image_failures: sameVideoVisualCheck.failures + crossVideoVisualCheck.failures,
            image_failure_reasons: { ...sameVideoVisualCheck.failure_reasons, ...crossVideoVisualCheck.failure_reasons },
            rejected: 0,
            contradictions: {},
          },
          cost_usage: {
            commerce_calls: refreshed.commerce_calls,
            verification_usage: sameVideoVisualCheck.usage ?? crossVideoVisualCheck.usage ?? {
              provider: 'none',
              model: 'none',
              requests: 0,
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
              cost_usd: 0,
            },
          },
          verified_mapping: {
            hit: true,
            provenance: verifiedMapping.provenance,
            product_id: verifiedMapping.product_id,
            ...(verifiedMapping.canonical_key ? { canonical_key: verifiedMapping.canonical_key } : {}),
            ...(verifiedMapping.track_id ? { track_id: verifiedMapping.track_id } : {}),
            track_diagnostics: {
              outcome: crossVideoReuse.identity ? 'CROSS_VIDEO_REUSED' : sameVideoReuse.mapping ? 'TRACK_REUSED' : 'TIME_WINDOW_HIT',
              candidate_count: durableMappings.filter((mapping) => Boolean(mapping.track_id)).length,
              decision_reason: crossVideoReuse.identity ? crossVideoReuse.reason : sameVideoReuse.reason,
              confidence: crossVideoReuse.identity ? crossVideoReuse.confidence : sameVideoReuse.confidence,
              visual_compared: sameVideoVisualCheck.compared + crossVideoVisualCheck.compared,
              visual_failures: sameVideoVisualCheck.failures + crossVideoVisualCheck.failures,
              ...(sameVideoReuse.mapping?.track_id ? { selected_track_id: sameVideoReuse.mapping.track_id } : {}),
              ...(crossVideoReuse.canonical_key ? { selected_cross_video_canonical_key: crossVideoReuse.canonical_key } : {}),
              ...(context?.timestamp_ms != null ? { observation_timestamp_ms: context.timestamp_ms } : {}),
              promotion_window_start_ms: verifiedMapping.timestamp_start_ms,
              promotion_window_end_ms: verifiedMapping.timestamp_end_ms,
              ...(record.vpm_observation_mode === 'nearby_frame_recovery' ? { observation_mode: 'nearby_frame_recovery' } : {}),
              trusted_observation_count: verifiedMapping.trusted_observations?.length ?? 0,
            },
            ...(crossVideoReuse.identity ? {
              reuse: 'cross_video',
              canonical_key: crossVideoReuse.canonical_key,
              confidence: crossVideoReuse.confidence,
              reason: crossVideoReuse.reason,
              visual_similarity: crossVideoReuse.visual_similarity,
              visual_confidence: crossVideoReuse.visual_confidence,
            } : sameVideoReuse.mapping ? {
              reuse: 'same_video',
              canonical_key: sameVideoReuse.canonical_key,
              confidence: sameVideoReuse.confidence,
              reason: sameVideoReuse.reason,
            } : {}),
          },
          latency_ms: total_ms,
          timing: {
            provider_retrieval_ms: refreshed.provider_retrieval_ms,
            candidate_verification_ms: (sameVideoVisualCheck.timing?.total_ms ?? 0) + (crossVideoVisualCheck.timing?.total_ms ?? 0),
            candidate_image_fetch_ms: (sameVideoVisualCheck.timing?.image_fetch_ms ?? 0) + (crossVideoVisualCheck.timing?.image_fetch_ms ?? 0),
            candidate_model_verification_ms: (sameVideoVisualCheck.timing?.model_ms ?? 0) + (crossVideoVisualCheck.timing?.model_ms ?? 0),
            verification_batches: [...(sameVideoVisualCheck.timing?.batches ?? []), ...(crossVideoVisualCheck.timing?.batches ?? [])],
            total_ms,
          },
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
      if (sameVideoVisualCheck.usage) {
        const usage = resolved.cost_usage.verification_usage;
        usage.requests += sameVideoVisualCheck.usage.requests ?? 0;
        usage.prompt_tokens += sameVideoVisualCheck.usage.prompt_tokens ?? 0;
        usage.completion_tokens += sameVideoVisualCheck.usage.completion_tokens ?? 0;
        usage.total_tokens += sameVideoVisualCheck.usage.total_tokens ?? 0;
        usage.cost_usd += sameVideoVisualCheck.usage.cost_usd ?? 0;
        resolved.verification.compared += sameVideoVisualCheck.compared;
        resolved.verification.image_failures += sameVideoVisualCheck.failures;
        for (const [reason, count] of Object.entries(sameVideoVisualCheck.failure_reasons)) {
          resolved.verification.image_failure_reasons[reason] = (resolved.verification.image_failure_reasons[reason] ?? 0) + count;
        }
        if (sameVideoVisualCheck.timing) {
          resolved.timing.candidate_verification_ms += sameVideoVisualCheck.timing.total_ms;
          resolved.timing.candidate_image_fetch_ms += sameVideoVisualCheck.timing.image_fetch_ms;
          resolved.timing.candidate_model_verification_ms += sameVideoVisualCheck.timing.model_ms;
          resolved.timing.verification_batches.push(...sameVideoVisualCheck.timing.batches);
        }
      }
      const feedbackEvidenceKey = evidenceFingerprint(description);
      const feedbackFamilyKey = feedbackFamily({
        category: resolved.query.category,
        subcategory: resolved.query.subcategory,
        brand: resolved.query.brand,
        model: resolved.query.model,
      });
      let feedbackLearning = {
        penalized: 0,
        suppressed: 0,
        signal_levels: { exact: 0, candidate_global: 0, family: 0 },
      };
      if (env.FEEDBACK_LEDGER && resolved.products.length) {
        try {
          const penalties = await feedbackPenalties(env, feedbackEvidenceKey, resolved.products, feedbackFamilyKey);
          const adjusted = applyFeedbackPenalties(resolved.products, penalties);
          resolved.products = adjusted.products;
          feedbackLearning = {
            penalized: adjusted.penalized,
            suppressed: adjusted.suppressed,
            signal_levels: adjusted.signal_levels,
          };
        } catch (error) {
          logSafeError(error);
        }
      }
      const total_ms = Date.now() - started + (sameVideoVisualCheck.timing?.total_ms ?? 0);
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
      const learningWrite = persistAlphaLearning({
        env,
        telemetry: alphaTelemetry,
        description,
        state: resolved.state,
        total_ms,
        products: resolved.products,
        query: resolved.query,
        verification_usage: resolved.cost_usage?.verification_usage,
        commerce_calls: resolved.cost_usage?.commerce_calls,
        context: {
          platform: context?.platform ?? null,
          content_ref: contentRef,
          timestamp_ms: context?.timestamp_ms ?? null,
        },
      }).catch((error) => { logSafeError(error); });
      if (ctx?.waitUntil) ctx.waitUntil(learningWrite);
      else await learningWrite;
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
      return jsonResponse({
        ...resolved,
        products: attributedProducts,
        feedback_learning: feedbackLearning,
        verified_mapping: {
          hit: false,
          reuse: crossVideoReuse.reason !== 'no_candidate' ? 'cross_video' : 'same_video',
          confidence: crossVideoReuse.reason !== 'no_candidate' ? crossVideoReuse.confidence : sameVideoReuse.confidence,
          reason: crossVideoReuse.reason !== 'no_candidate' ? crossVideoReuse.reason : sameVideoReuse.reason,
          same_video_reason: sameVideoReuse.reason,
          cross_video_reason: crossVideoReuse.reason,
          ...(typeof crossVideoReuse.visual_similarity === 'number'
            ? { visual_similarity: crossVideoReuse.visual_similarity }
            : typeof sameVideoReuse.visual_similarity === 'number'
              ? { visual_similarity: sameVideoReuse.visual_similarity }
              : {}),
          ...(typeof crossVideoReuse.visual_confidence === 'number'
            ? { visual_confidence: crossVideoReuse.visual_confidence }
            : typeof sameVideoReuse.visual_confidence === 'number'
              ? { visual_confidence: sameVideoReuse.visual_confidence }
              : {}),
          candidates_compared: sameVideoVisualCheck.compared + crossVideoVisualCheck.compared,
          visual_failures: sameVideoVisualCheck.failures + crossVideoVisualCheck.failures,
        },
        latency_ms: total_ms,
        timing: { ...resolved.timing, total_ms },
        ...(resolved.state === 'TEMPORARILY_UNAVAILABLE' ? { failure_state: 'TEMPORARILY_UNAVAILABLE', retryable: true } :
          resolved.state === 'NO_RESULTS' ? { failure_state: 'NO_RESULTS', retryable: false } : {}) });
    }
    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) {
    logSafeError(error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown API error' }, 500);
  }
} };
