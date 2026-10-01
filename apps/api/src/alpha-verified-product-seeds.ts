import type { VerifiedProductMapping } from './verified-product-mapping.js';

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
];
