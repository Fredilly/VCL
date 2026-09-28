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
];
