import { ALPHA_VERIFIED_PRODUCT_SEEDS } from './alpha-verified-product-seeds.js';
import { canonicalProductIdentity } from './canonical-product-memory.js';
import type { ResolvedIntakeItem, VideoRef } from './roster-intake.js';
import { familyAnchors, linkEvidence } from './roster-outline.js';
import type { VerifiedProductMapping } from './verified-product-mapping.js';

/**
 * Replacing hand-seeded roster rows with an intake roster, safely.
 *
 * The seeds for a video are family-level rows written by hand. An intake roster
 * for the same video is finer (one row per variant). Running both gives the
 * verifier near-identical siblings, and it abstains on those. Deleting the
 * seeds first would lose their canonical keys, windows and observations, and
 * leave a hole wherever the new roster has nothing READY yet.
 *
 * So replacement is per seed, explicit and reversible:
 * - a seed is retired only when at least one READY variant replaces it; a seed
 *   with no READY replacement stays active, so coverage never drops;
 * - each replacing row names the seed in `supersedes`. The resolver drops a
 *   superseded seed from the active candidates (partner-roster.ts); the seed
 *   itself is not deleted, and removing the replacement restores it;
 * - the plan records the seed's canonical key next to its replacements, and a
 *   replacement inherits the seed's discussion window (a retrieval prior, not
 *   identity). The seed's trusted observations stay on the seed: copying them
 *   onto a replacement is an identity merge and is deliberately not done here;
 * - nothing here activates itself: a plan is a draft until someone signs it.
 */

export type SeedReplacementBasis = 'same_listing' | 'same_code' | 'family' | 'none';

export type SeedReplacementEntry = {
  seed_product_id: string;
  seed_title: string;
  seed_canonical_key: string;
  basis: SeedReplacementBasis;
  /** READY variants that would take over. Empty means the seed stays active. */
  replaced_by: string[];
  /** Related variants that are not READY and therefore replace nothing yet. */
  not_ready: string[];
  action: 'supersede' | 'keep_seed';
  /** True when the link between seed and variants is a judgement (family name), not shared evidence. */
  needs_signoff: boolean;
};

export type SeedReplacementPlan = {
  platform: string;
  content_ref: string;
  status: 'DRAFT_NOT_APPROVED' | 'APPROVED';
  approved_by: string | null;
  entries: SeedReplacementEntry[];
  summary: { seeds: number; superseded: number; kept: number; active_after: number; duplicates_after: number };
};

const norm = (value: string | null | undefined) => (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const refOf = (platform: string, ref: string) => {
  const raw = ref.trim().replace(/^youtube:/i, '');
  if (platform.trim().toLowerCase() !== 'youtube') return raw.toLowerCase();
  try { return (new URL(raw).searchParams.get('v') ?? raw).toLowerCase(); } catch { return raw.toLowerCase(); }
};

export function seedsForVideo(video: VideoRef, seeds: VerifiedProductMapping[] = ALPHA_VERIFIED_PRODUCT_SEEDS): VerifiedProductMapping[] {
  return seeds.filter(seed => seed.platform.trim().toLowerCase() === video.platform.trim().toLowerCase()
    && refOf(seed.platform, seed.content_ref) === refOf(video.platform, video.content_ref));
}

const variantKey = (item: ResolvedIntakeItem) => (item.sku ?? item.gtin ?? '');
const listingKey = (url: string) => {
  const evidence = linkEvidence(url);
  if (evidence.listing_id) return evidence.listing_id.toLowerCase();
  try { const parsed = new URL(evidence.url); return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}`.toLowerCase(); } catch { return url.toLowerCase(); }
};

export function planSeedReplacement(video: VideoRef, items: ResolvedIntakeItem[], seeds: VerifiedProductMapping[] = ALPHA_VERIFIED_PRODUCT_SEEDS): SeedReplacementPlan {
  const videoSeeds = seedsForVideo(video, seeds);
  const entries: SeedReplacementEntry[] = videoSeeds.map(seed => {
    const seedListing = listingKey(seed.destination);
    const seedCode = /^[A-Z]{2,8}-/.test(seed.product_id) ? '' : norm(seed.product_id); // FP-/POSH- are listing handles, not codes
    const seedAnchors = familyAnchors(seed.title, seed.brand);
    const related = (test: (item: ResolvedIntakeItem) => boolean) => items.filter(item => variantKey(item) && test(item));
    const sameListing = related(item => item.urls.some(url => listingKey(url) === seedListing));
    const sameCode = seedCode ? related(item => norm(item.sku) === seedCode) : [];
    const family = related(item => {
      const anchors = familyAnchors(item.family ?? item.title ?? '', item.brand);
      // Every model word of the shorter name must appear in the longer one.
      const [small, large] = anchors.length <= seedAnchors.length ? [anchors, seedAnchors] : [seedAnchors, anchors];
      // Whole words only: "Trunkie" is not "Side Trunk".
      return small.length > 0 && small.every(word => large.includes(word));
    });
    const [basis, matched]: [SeedReplacementBasis, ResolvedIntakeItem[]] = sameListing.length ? ['same_listing', sameListing]
      : sameCode.length ? ['same_code', sameCode] : family.length ? ['family', family] : ['none', []];
    // On a family match every READY variant of the family takes over, not just one.
    const pool = basis === 'none' ? [] : [...new Set([...matched, ...family])];
    const ready = pool.filter(item => item.status === 'READY').map(variantKey);
    const identity = canonicalProductIdentity({ mapping: seed, model: null, merchantItemId: seed.product_id, verifiedAt: '2026-10-06T00:00:00.000Z' });
    return {
      seed_product_id: seed.product_id, seed_title: seed.title, seed_canonical_key: identity.canonical_key, basis,
      replaced_by: ready, not_ready: pool.filter(item => item.status !== 'READY').map(variantKey),
      action: ready.length ? 'supersede' as const : 'keep_seed' as const,
      needs_signoff: basis === 'family',
    };
  });
  const superseded = entries.filter(entry => entry.action === 'supersede').length;
  const readyVariants = new Set(items.filter(item => item.status === 'READY').map(variantKey));
  // After replacement the active roster is: READY variants + seeds nothing replaced.
  // A duplicate would be a kept seed that also has a READY variant of its own product.
  const duplicates = entries.filter(entry => entry.action === 'keep_seed' && entry.replaced_by.length).length;
  return {
    platform: video.platform, content_ref: video.content_ref, status: 'DRAFT_NOT_APPROVED', approved_by: null, entries,
    summary: { seeds: entries.length, superseded, kept: entries.length - superseded, active_after: readyVariants.size + entries.length - superseded, duplicates_after: duplicates },
  };
}

/**
 * The intake roster as resolver mappings (the VERIFIED_PRODUCT_MAPPINGS_JSON
 * shape), with the plan applied. One row per purchasable offer; rows of one
 * variant share its id and merge into one identity with several offers.
 *
 * `applyDraft` exists for isolated evaluation only (a local replay worker).
 * Outside of that, a plan must be APPROVED before any seed is superseded.
 */
export function rosterMappingsWithPlan(
  video: VideoRef, items: ResolvedIntakeItem[], plan: SeedReplacementPlan | null,
  options: { applyDraft?: boolean; seeds?: VerifiedProductMapping[] } = {},
): VerifiedProductMapping[] {
  const active = plan && (plan.status === 'APPROVED' || options.applyDraft) ? plan : null;
  const seeds = seedsForVideo(video, options.seeds);
  const out: VerifiedProductMapping[] = [];
  for (const item of items) {
    if (item.status !== 'READY' || !item.verified_image) continue;
    const id = variantKey(item);
    const replaces = (active?.entries ?? []).filter(entry => entry.action === 'supersede' && entry.replaced_by.includes(id));
    const replacedSeeds = replaces.map(entry => seeds.find(seed => seed.product_id === entry.seed_product_id)).filter((seed): seed is VerifiedProductMapping => Boolean(seed));
    const windowSeed = replacedSeeds.find(seed => typeof seed.candidate_window_start_ms === 'number' && typeof seed.candidate_window_end_ms === 'number');
    const start = item.candidate_window_start_ms ?? windowSeed?.candidate_window_start_ms;
    const end = item.candidate_window_end_ms ?? windowSeed?.candidate_window_end_ms;
    const photos = [...new Set(item.offers.map(offer => offer.image).filter((url): url is string => Boolean(url)))];
    for (const offer of item.offers) {
      if (offer.availability !== 'in_stock') continue;
      const image = offer.image ?? item.verified_image;
      out.push({
        platform: video.platform, content_ref: video.content_ref, scope: 'entire_video',
        object_type: item.object_type!, brand: item.brand!, product_id: id, variant_id: id,
        ...(item.family ? { family: item.family } : {}),
        title: [item.brand, item.title].filter(Boolean).join(' '),
        destination: offer.destination, image_reference: image,
        reference_images: photos.filter(url => url !== image).slice(0, 6),
        price: offer.price, currency: offer.currency, provider: offer.provider,
        ...(typeof start === 'number' && typeof end === 'number' ? { candidate_window_start_ms: start, candidate_window_end_ms: end } : {}),
        ...(item.sku_source === 'partner_group' ? { identity_scope: 'video_local' as const } : {}),
        ...(replaces.length ? { supersedes: replaces.map(entry => entry.seed_product_id) } : {}),
        provenance: 'admin_verified',
      });
    }
  }
  return out;
}
