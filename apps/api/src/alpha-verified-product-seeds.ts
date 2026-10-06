import type { VerifiedProductMapping } from './verified-product-mapping.js';
import { canonicalProductIdentity, type CanonicalProductIdentity } from './canonical-product-memory.js';

/**
 * Small alpha-only verified registry for creator demos.
 * This is data, not resolver logic. Entries must be clearly provenance-tagged.
 *
 * Ric's current shirt is a deliberate next-best test approximation until
 * Ric or Mizzen+Main confirms the actual worn SKU.
 */
export const ALPHA_VERIFIED_PRODUCT_SEEDS: VerifiedProductMapping[] = [
  {
    platform: 'youtube',
    content_ref: 'BR5fQYeqlJo',
    scope: 'entire_video',
    object_type: 'shirt',
    brand: 'Mizzen+Main',
    product_id: '1WS-1916',
    title: 'Leeward Dress Shirt - Steel Blue Tonal Texture',
    destination: 'https://www.mizzenandmain.com/products/steel-blue-tonal-texture-leeward-dress-shirt',
    image_reference: 'https://cdn.shopify.com/s/files/1/0163/4002/files/1WS-1916_Folded.jpg?width=3840',
    provider: null,
    provenance: 'admin_verified',
  },
  {
    platform: 'youtube',
    content_ref: 'PsL2hXoDVCw',
    scope: 'entire_video',
    object_type: 'cap',
    brand: 'Kith & \'47',
    product_id: 'KHMA050113-001',
    title: "Kith & '47 for the New York Yankees Sun Faded Franchise LS Cap - Black",
    destination: 'https://kith.com/collections/kith-for-the-new-york-yankees-2026/products/khma050113-001',
    image_reference: 'https://kith.com/cdn/shop/files/KHMA050113-001-Detail.jpg?v=1788561574&width=1920',
    provider: null,
    provenance: 'admin_verified',
  },
  {
    platform: 'youtube',
    content_ref: 'wDev1WhWvQs',
    scope: 'entire_video',
    object_type: 'shirt',
    brand: 'Jordan',
    product_id: 'II5381-417',
    title: "Jordan Men's Polo - Old Royal / White",
    destination: 'https://www.nike.com/t/jordan-mens-polo-mbLOwHgG/II5381-417',
    image_reference: null,
    provider: null,
    provenance: 'admin_verified',
  },
  {
    platform: 'youtube',
    content_ref: '313GzQj7TS8',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'M20511',
    title: 'Louis Vuitton Neverfull MM Midnight Fuchsia - Spring in the City',
    destination: 'https://poshmark.com/listing/LOUIS-VUITTON-Neverfull-Tote-Bag-Midnight-Fuschia-Pink-6ab1a7747b19910922bcdc97',
    image_reference: 'https://di2ponv0v5otw.cloudfront.net/posts/2026/09/21/6ab1a7747b19910922bcdc97/l_6ab1a7747b19910922bcdc98.jpg',
    price: '7999',
    currency: 'USD',
    provider: 'poshmark',
    trusted_observations: [{
      observed_at: '2026-10-05T00:00:00Z',
      reason: 'model_exact',
      confidence: 1,
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram'],
      distinctive_features: ['Neverfull MM', 'Spring in the City'],
      shape_silhouette: ['tote'],
      style_attributes: ['Midnight Fuchsia', 'gradient monogram'],
      color: 'Midnight Fuchsia',
      material: 'coated canvas',
    }],
    provenance: 'admin_verified',
  },
  {
    platform: 'youtube',
    content_ref: '313GzQj7TS8',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'M13915',
    title: 'Louis Vuitton Keepall Bandouliere 45 - Monogram Iridescent',
    destination: 'https://poshmark.com/listing/NEW-Louis-Vuitton-Gray-Iridescent-Monogram-Keepall-Bandouliere-45-SUPER-RARE-6a03a4adb7f0acc2d7071f98',
    image_reference: 'https://di2ponv0v5otw.cloudfront.net/posts/2026/05/12/6a03a4adb7f0acc2d7071f98/l_6a03a4c13509d12a5bdd3136.jpg',
    price: '5225',
    currency: 'USD',
    provider: 'poshmark',
    trusted_observations: [{
      observed_at: '2026-10-05T00:00:00Z',
      reason: 'model_exact',
      confidence: 1,
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram'],
      distinctive_features: ['Keepall Bandouliere 45', 'earphones charm'],
      shape_silhouette: ['duffel', 'travel bag'],
      style_attributes: ['Monogram Iridescent', 'rainbow effect'],
      color: 'silver multicolor',
      material: 'iridescent coated canvas',
    }],
    provenance: 'admin_verified',
  },
  {
    platform: 'youtube',
    content_ref: '1auV6jxLh_Q',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'M3A350',
    title: 'Louis Vuitton Speedy Soft 25 - Damier Ebene / Monogram Rouge',
    destination: 'https://en.louisvuitton.com/eng-nl/products/speedy-25-soft-damier-ebene-P00143176/M3A350',
    image_reference: 'https://us.louisvuitton.com/images/is/image/lv/1/PP_VP_L/louis-vuitton-speedy-soft-25--M3A350_PM2_Front%20view.jpg',
    price: '3450',
    currency: 'USD',
    provider: 'louisvuitton.com',
    provenance: 'admin_verified',
  },
  {
    platform: 'youtube',
    content_ref: '1auV6jxLh_Q',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'N48280',
    title: 'Louis Vuitton Pochette Métis - Damier Ebene / Monogram Rouge',
    destination: 'https://en.louisvuitton.com/eng-nl/products/pochette-metis-pm-damier-ebene-P00143333/N48280',
    image_reference: 'https://us.louisvuitton.com/images/is/image/lv/1/PP_VP_L/louis-vuitton-pochette-metis---N48280_PM2_Front%20view.jpg',
    price: '3200',
    currency: 'USD',
    provider: 'louisvuitton.com',
    provenance: 'admin_verified',
  },
  {
    platform: 'youtube',
    content_ref: '1auV6jxLh_Q',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'N40952',
    title: 'Louis Vuitton Neverfull Inside Out MM - Damier Ebene / Monogram Rouge',
    destination: 'https://us.louisvuitton.com/eng-us/products/neverfull-inside-out-mm-h33-nvprod8010271v/N40952',
    image_reference: 'https://us.louisvuitton.com/images/is/image/lv/1/PP_VP_L/louis-vuitton-neverfull-inside-out-mm--N40952_PM2_Front%20view.jpg',
    price: '3100',
    currency: 'USD',
    provider: 'louisvuitton.com',
    provenance: 'admin_verified',
  },
  {
    platform: 'youtube',
    content_ref: '1auV6jxLh_Q',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'N48279',
    title: 'Louis Vuitton Alma BB - Damier Ebene / Monogram Rouge',
    destination: 'https://www.buyma.com/r/N48279/',
    image_reference: 'https://us.louisvuitton.com/images/is/image/lv/1/PP_VP_L/louis-vuitton-alma-bb--N48279_PM2_Front%20view.jpg',
    price: '2150',
    currency: 'USD',
    provider: 'buyma',
    provenance: 'admin_verified',
  },
  {
    platform: 'youtube',
    content_ref: '1auV6jxLh_Q',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'M2A904',
    title: 'Louis Vuitton Pochette Liv - Damier Ebene / Monogram Rouge',
    destination: 'https://ca.louisvuitton.com/fra-ca/produits/pochette-liv-damier-ebene-nvprod8030013v/M2A904',
    image_reference: 'https://us.louisvuitton.com/images/is/image/lv/1/PP_VP_L/louis-vuitton-pochette-liv--M2A904_PM2_Front%20view.jpg',
    price: '1950',
    currency: 'USD',
    provider: 'louisvuitton.com',
    provenance: 'admin_verified',
  },
  {
    platform: 'youtube',
    content_ref: '1auV6jxLh_Q',
    scope: 'entire_video',
    object_type: 'passport cover',
    brand: 'Louis Vuitton',
    product_id: 'M3A947',
    title: 'Louis Vuitton Passport Cover - Damier Ebene',
    destination: 'https://pl.louisvuitton.com/pol-pl/produkty/okadka-na-paszport-damier-ebene-nvprod8030014v/M3A947',
    image_reference: 'https://us.louisvuitton.com/images/is/image/lv/1/PP_VP_L/louis-vuitton-passport-cover--M3A947_PM2_Front%20view.jpg',
    price: '400',
    currency: 'USD',
    provider: 'louisvuitton.com',
    provenance: 'admin_verified',
  }
];


const ALPHA_VERIFIED_ROSTER_ALIASES: Record<string, string> = {
  // Paid-pilot style creator review: same verified product roster appears in this
  // second video. The current video remains open-world: these SKUs are candidates,
  // not an assertion that every bag shown belongs to the roster.
  'kbwtwhnr0_e': '1auv6jxlh_q',
};

function normalizeSeedContentRef(platform: string | null | undefined, value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  if ((platform ?? '').trim().toLowerCase() !== 'youtube') return raw.toLowerCase();
  try {
    const url = new URL(raw);
    const id = url.searchParams.get('v');
    if (id) return id.toLowerCase();
  } catch {}
  return raw.replace(/^youtube:/i, '').toLowerCase();
}

function canonicalizeAlphaSeed(mapping: VerifiedProductMapping): {
  mapping: VerifiedProductMapping;
  identity: CanonicalProductIdentity;
} {
  // Alpha seeds are verified product roster entries. They become Product Memory
  // candidates, never automatic Exact matches: the current frame must still pass
  // the normal visual verifier before reuse.
  const identity = canonicalProductIdentity({
    mapping,
    model: null,
    merchantItemId: mapping.product_id,
    verifiedAt: '2026-10-06T00:00:00.000Z',
  });
  return {
    mapping: {
      ...mapping,
      canonical_key: identity.canonical_key,
      track_id: identity.canonical_key,
    },
    identity,
  };
}

export function alphaVerifiedCanonicalRowsForContent(
  platform: string | null | undefined,
  contentRef: string | null | undefined,
): Array<{ mapping: VerifiedProductMapping; identity: CanonicalProductIdentity }> {
  const normalizedPlatform = (platform ?? '').trim().toLowerCase();
  const normalizedRef = normalizeSeedContentRef(platform, contentRef);
  if (!normalizedPlatform || !normalizedRef) return [];
  const rosterRef = ALPHA_VERIFIED_ROSTER_ALIASES[normalizedRef] ?? normalizedRef;

  const unique = new Map<string, { mapping: VerifiedProductMapping; identity: CanonicalProductIdentity }>();
  for (const mapping of ALPHA_VERIFIED_PRODUCT_SEEDS) {
    if (mapping.platform.trim().toLowerCase() !== normalizedPlatform) continue;
    if (normalizeSeedContentRef(mapping.platform, mapping.content_ref) !== rosterRef) continue;
    const effectiveMapping = rosterRef === normalizedRef
      ? mapping
      : { ...mapping, content_ref: contentRef ?? normalizedRef };
    const row = canonicalizeAlphaSeed(effectiveMapping);
    if (!unique.has(row.identity.canonical_key)) unique.set(row.identity.canonical_key, row);
  }
  return [...unique.values()];
}

export function alphaVerifiedCanonicalIdentitiesExcludingContent(
  platform: string | null | undefined,
  contentRef: string | null | undefined,
): CanonicalProductIdentity[] {
  const normalizedPlatform = (platform ?? '').trim().toLowerCase();
  const normalizedRef = normalizeSeedContentRef(platform, contentRef);
  const unique = new Map<string, CanonicalProductIdentity>();

  for (const mapping of ALPHA_VERIFIED_PRODUCT_SEEDS) {
    const sameContent = mapping.platform.trim().toLowerCase() === normalizedPlatform
      && normalizeSeedContentRef(mapping.platform, mapping.content_ref) === normalizedRef;
    if (sameContent) continue;
    const row = canonicalizeAlphaSeed(mapping);
    if (!unique.has(row.identity.canonical_key)) unique.set(row.identity.canonical_key, row.identity);
  }
  return [...unique.values()];
}
