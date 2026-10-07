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
  // Partner-roster pilot: Handbagholic "Top 10 BEST Louis Vuitton Bags To Buy Right Now".
  // Treat these as creator-provided candidates. candidate_window_* narrows the relevant
  // roster at each moment but is not identity truth. The same-video visual verifier must
  // still earn Exact; wrong variants should
  // fall through to Similar/Related commerce results rather than being forced Exact.
  {
    platform: 'youtube',
    content_ref: 'n9u8ynhBdSo',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'FP-1977706',
    candidate_window_start_ms: 24000,
    candidate_window_end_ms: 161000,
    title: 'Louis Vuitton Monogram Side Trunk PM',
    destination: 'https://www.fashionphile.com/products/louis-vuitton-monogram-side-trunk-pm-1977706',
    provider: 'fashionphile.com',
    trusted_observations: [{
      observed_at: '2026-10-07T00:00:00Z',
      reason: 'visual_confirmed',
      confidence: 0.9,
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram'],
      distinctive_features: ['Side Trunk', 'metallic corner hardware', 'leather side trim'],
      shape_silhouette: ['soft-sided trunk bag'],
      style_attributes: ['monogram canvas', 'PM size'],
      color: 'brown',
      material: 'coated canvas',
    }],
    provenance: 'creator_verified',
  },
  {
    platform: 'youtube',
    content_ref: 'n9u8ynhBdSo',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'M28392',
    candidate_window_start_ms: 163000,
    candidate_window_end_ms: 228000,
    title: 'Louis Vuitton Vagabond Hobo Bag',
    destination: 'https://uk.louisvuitton.com/eng-gb/products/vagabond-hobo-bag-h39-nvprod7260131v/M28392',
    provider: 'louisvuitton.com',
    trusted_observations: [{
      observed_at: '2026-10-07T00:00:00Z',
      reason: 'visual_confirmed',
      confidence: 0.95,
      visible_text: [],
      logos_markings: ['Louis Vuitton'],
      distinctive_features: ['Vagabond Hobo', 'thick adjustable strap', 'slouchy hobo profile'],
      shape_silhouette: ['hobo bag'],
      style_attributes: ['mens collection', 'leather'],
      color: 'black',
      material: 'leather',
    }],
    provenance: 'creator_verified',
  },
  {
    platform: 'youtube',
    content_ref: 'n9u8ynhBdSo',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'FP-1925620',
    candidate_window_start_ms: 284000,
    candidate_window_end_ms: 305000,
    title: 'Louis Vuitton Monogram Roses Neverfull MM',
    destination: 'https://www.fashionphile.com/products/louis-vuitton-monogram-roses-neverfull-mm-1925620',
    image_reference: 'https://www.fashionphile.com/cdn/shop/files/42edbf9959473e53ec1c92e1c8327770.jpg?v=1783789851&width=1946',
    provider: 'fashionphile.com',
    trusted_observations: [{
      observed_at: '2026-10-07T00:00:00Z',
      reason: 'visual_confirmed',
      confidence: 0.8,
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram'],
      distinctive_features: ['Neverfull MM', 'open tote', 'large painted pink and orange rose print overlay'],
      shape_silhouette: ['tote'],
      style_attributes: ['Monogram Roses', 'MM size', 'bright floral overlay'],
      color: 'brown multicolor',
      material: 'coated canvas',
    }],
    provenance: 'creator_verified',
  },
  {
    platform: 'youtube',
    content_ref: 'n9u8ynhBdSo',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'FP-1981368',
    candidate_window_start_ms: 335000,
    candidate_window_end_ms: 399000,
    title: 'Louis Vuitton Monogram CarryAll MM',
    destination: 'https://www.fashionphile.com/products/louis-vuitton-monogram-carryall-mm-1981368',
    provider: 'fashionphile.com',
    trusted_observations: [{
      observed_at: '2026-10-07T00:00:00Z',
      reason: 'visual_confirmed',
      confidence: 0.95,
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram'],
      distinctive_features: ['CarryAll MM', 'leather tie closure', 'luggage tag'],
      shape_silhouette: ['large shoulder tote'],
      style_attributes: ['MM size', 'monogram canvas'],
      color: 'brown',
      material: 'coated canvas',
    }],
    provenance: 'creator_verified',
  },
  {
    platform: 'youtube',
    content_ref: 'n9u8ynhBdSo',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'FP-1983129',
    candidate_window_start_ms: 402000,
    candidate_window_end_ms: 522000,
    title: 'Louis Vuitton Monogram NeoNoe MM Black',
    destination: 'https://www.fashionphile.com/products/louis-vuitton-monogram-neonoe-mm-black-1983129',
    provider: 'fashionphile.com',
    trusted_observations: [{
      observed_at: '2026-10-07T00:00:00Z',
      reason: 'visual_confirmed',
      confidence: 1,
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram'],
      distinctive_features: ['NeoNoe MM', 'black leather trim', 'center zipper compartment'],
      shape_silhouette: ['bucket bag'],
      style_attributes: ['MM size', 'Noir black trim', 'monogram canvas'],
      color: 'brown black',
      material: 'coated canvas',
    }],
    provenance: 'creator_verified',
  },
  {
    platform: 'youtube',
    content_ref: 'n9u8ynhBdSo',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'M2A078',
    candidate_window_start_ms: 524000,
    candidate_window_end_ms: 607000,
    title: 'Louis Vuitton Multipass',
    destination: 'https://us.louisvuitton.com/eng-us/products/Multipass-G81-nvprod7770009v/M2A078',
    provider: 'louisvuitton.com',
    trusted_observations: [{
      observed_at: '2026-10-07T00:00:00Z',
      reason: 'visual_confirmed',
      confidence: 0.95,
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram'],
      distinctive_features: ['Multipass', 'leather top handle', 'chain with woven leather', 'long adjustable strap'],
      shape_silhouette: ['slouchy shoulder bag'],
      style_attributes: ['monogram canvas'],
      color: 'brown',
      material: 'coated canvas',
    }],
    provenance: 'creator_verified',
  },
  {
    platform: 'youtube',
    content_ref: 'n9u8ynhBdSo',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'M14526',
    candidate_window_start_ms: 610000,
    candidate_window_end_ms: 671000,
    title: 'Louis Vuitton Trunkie Bag Monogram',
    destination: 'https://uk.louisvuitton.com/eng-gb/products/trunkie-bag-monogram-nvprod6090072v/M14526',
    image_reference: 'https://uk.louisvuitton.com/images/is/image/lv/1/PP_VP_L/louis-vuitton-trunkie-bag--M14526_PM1_Worn%20view.jpg',
    provider: 'louisvuitton.com',
    trusted_observations: [{
      observed_at: '2026-10-07T00:00:00Z',
      reason: 'visual_confirmed',
      confidence: 0.95,
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram'],
      distinctive_features: ['gold-tone rivets', 'metallic corners', 'S-lock'],
      shape_silhouette: ['flat trunk-style shoulder bag'],
      style_attributes: ['monogram canvas', 'dual strap'],
      color: 'brown',
      material: 'coated canvas',
    }],
    provenance: 'creator_verified',
  },
  {
    platform: 'youtube',
    content_ref: 'n9u8ynhBdSo',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'POSH-6a3f49685919e011180b400c',
    candidate_window_start_ms: 682000,
    candidate_window_end_ms: 741000,
    title: 'Louis Vuitton Vanity Chain Pouch Monogram Brown',
    destination: 'https://poshmark.com/listing/Louis-Vuitton-Monogram-Vanity-Chain-Pouch-Brown-6a3f49685919e011180b400c',
    provider: 'poshmark',
    trusted_observations: [{
      observed_at: '2026-10-07T00:00:00Z',
      reason: 'visual_confirmed',
      confidence: 0.95,
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram', 'LV bell charm'],
      distinctive_features: ['Vanity Chain Pouch', 'front lock', 'chain strap'],
      shape_silhouette: ['vanity case pouch'],
      style_attributes: ['reverse monogram top', 'dark brown monogram body'],
      color: 'brown toffee',
      material: 'coated canvas',
    }],
    provenance: 'creator_verified',
  },
  {
    platform: 'youtube',
    content_ref: 'n9u8ynhBdSo',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'M46784',
    candidate_window_start_ms: 744000,
    candidate_window_end_ms: 805000,
    title: 'Louis Vuitton High Rise Monogram Bumbag',
    destination: 'https://poshmark.com/listing/Louis-Vuitton-High-Rise-Monogram-Bumbag-M46784-Full-Set-Receipt-6abd335f046d1f7c1de21801',
    provider: 'poshmark',
    trusted_observations: [{
      observed_at: '2026-10-07T00:00:00Z',
      reason: 'visual_confirmed',
      confidence: 1,
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram'],
      distinctive_features: ['High Rise Bumbag', 'front zipper', 'adjustable canvas strap'],
      shape_silhouette: ['belt bag', 'bumbag'],
      style_attributes: ['M46784', 'monogram canvas'],
      color: 'brown',
      material: 'coated canvas',
    }],
    provenance: 'creator_verified',
  },
  {
    platform: 'youtube',
    content_ref: 'n9u8ynhBdSo',
    scope: 'entire_video',
    object_type: 'bag',
    brand: 'Louis Vuitton',
    product_id: 'FP-1985008',
    candidate_window_start_ms: 805000,
    candidate_window_end_ms: 955000,
    title: 'Louis Vuitton Monogram Speedy Bandouliere 25',
    destination: 'https://www.fashionphile.com/products/louis-vuitton-monogram-speedy-bandouliere-25-1985008',
    provider: 'fashionphile.com',
    trusted_observations: [{
      observed_at: '2026-10-07T00:00:00Z',
      reason: 'visual_confirmed',
      confidence: 0.9,
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram'],
      distinctive_features: ['Speedy Bandouliere 25', 'top handles', 'zip closure'],
      shape_silhouette: ['Speedy duffle handbag'],
      style_attributes: ['25 size', 'monogram canvas'],
      color: 'brown',
      material: 'coated canvas',
    }],
    provenance: 'creator_verified',
  },

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
  timestampMs?: number | null,
): Array<{ mapping: VerifiedProductMapping; identity: CanonicalProductIdentity }> {
  const normalizedPlatform = (platform ?? '').trim().toLowerCase();
  const normalizedRef = normalizeSeedContentRef(platform, contentRef);
  if (!normalizedPlatform || !normalizedRef) return [];
  const rosterRef = ALPHA_VERIFIED_ROSTER_ALIASES[normalizedRef] ?? normalizedRef;

  const unique = new Map<string, { mapping: VerifiedProductMapping; identity: CanonicalProductIdentity }>();
  for (const mapping of ALPHA_VERIFIED_PRODUCT_SEEDS) {
    if (mapping.platform.trim().toLowerCase() !== normalizedPlatform) continue;
    if (normalizeSeedContentRef(mapping.platform, mapping.content_ref) !== rosterRef) continue;
    if (typeof timestampMs === 'number') {
      const start = mapping.candidate_window_start_ms;
      const end = mapping.candidate_window_end_ms;
      if (typeof start === 'number' && typeof end === 'number' && (timestampMs < start || timestampMs > end)) continue;
    }
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
