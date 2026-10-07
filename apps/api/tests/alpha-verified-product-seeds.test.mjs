import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mappingMod = loadModule(resolve(here, '../src/verified-product-mapping.ts'));
const seedMod = loadModule(resolve(here, '../src/alpha-verified-product-seeds.ts'));

const ricShirt = {
  category: 'apparel',
  subcategory: 'shirt',
  brand_candidate: null,
  model_candidate: null,
  color: 'light blue',
  material: '',
  style_attributes: ['gingham check pattern', 'long sleeve'],
  visible_text: [],
  logos_markings: [],
  distinctive_features: [],
  hardware_details: [],
  shape_silhouette: [],
  search_terms: ['light blue gingham shirt'],
  confidence: 0.9,
  identity_confidence: 0.1,
};


const stephenAJordanPolo = {
  category: 'apparel',
  subcategory: 'polo',
  brand_candidate: 'Jordan',
  model_candidate: null,
  color: 'blue',
  material: '',
  style_attributes: ['polo shirt', 'short sleeve'],
  visible_text: [],
  logos_markings: ['Jumpman'],
  distinctive_features: [],
  hardware_details: [],
  shape_silhouette: ['polo'],
  search_terms: ['Jordan blue polo'],
  confidence: 0.95,
  identity_confidence: 0.3,
};

const kithYankeesCap = {
  category: 'apparel',
  subcategory: 'baseball cap',
  brand_candidate: 'Kith',
  model_candidate: null,
  color: 'black',
  material: 'cotton',
  style_attributes: ['low profile', 'fitted'],
  visible_text: ['NY'],
  logos_markings: ['New York Yankees'],
  distinctive_features: ['sun faded finish'],
  hardware_details: [],
  shape_silhouette: ['baseball cap'],
  search_terms: ['black Yankees cap'],
  confidence: 0.95,
  identity_confidence: 0.3,
};

test('Ric alpha creator demo resolves the configured next-best verified product for the whole video', () => {
  const hit = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'BR5fQYeqlJo',
    timestampMs: 123000,
    description: ricShirt,
  });

  assert.equal(hit?.product_id, '1WS-1916');
  assert.equal(hit?.scope, 'entire_video');
  assert.equal(hit?.provenance, 'admin_verified');
  assert.equal(hit?.destination, 'https://www.mizzenandmain.com/products/steel-blue-tonal-texture-leeward-dress-shirt');
  assert.ok(hit?.image_reference?.includes('1WS-1916_Folded.jpg'));
});

test('Ric seed does not fire for a non-shirt click in the same video', () => {
  const miss = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'BR5fQYeqlJo',
    timestampMs: 123000,
    description: { ...ricShirt, category: 'electronics', subcategory: 'microphone', search_terms: ['podcast microphone'] },
  });

  assert.equal(miss, null);
});

test('Ronnie Fieg video resolves the verified Kith Yankees cap across the video', () => {
  const hit = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'PsL2hXoDVCw',
    timestampMs: 600000,
    description: kithYankeesCap,
  });

  assert.equal(hit?.product_id, 'KHMA050113-001');
  assert.equal(hit?.scope, 'entire_video');
  assert.equal(hit?.provenance, 'admin_verified');
  assert.equal(hit?.brand, "Kith & '47");
  assert.ok(hit?.destination.endsWith('/khma050113-001'));
  assert.ok(hit?.image_reference?.includes('KHMA050113-001-Detail.jpg'));
});

test('Ronnie Fieg cap seed does not fire for jacket, jeans, or sunglasses clicks', () => {
  for (const subcategory of ['jacket', 'jeans', 'sunglasses']) {
    const miss = mappingMod.lookupVerifiedProductMapping({
      mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
      allowTestFixtures: false,
      platform: 'youtube',
      contentRef: 'PsL2hXoDVCw',
      timestampMs: 600000,
      description: {
        ...kithYankeesCap,
        subcategory,
        style_attributes: [],
        shape_silhouette: [subcategory],
        search_terms: [subcategory],
      },
    });
    assert.equal(miss, null, `seed must not leak into ${subcategory}`);
  }
});


test('Stephen A. Smith video resolves the verified Jordan polo across the video', () => {
  const hit = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'wDev1WhWvQs',
    timestampMs: 120000,
    description: stephenAJordanPolo,
  });

  assert.equal(hit?.product_id, 'II5381-417');
  assert.equal(hit?.scope, 'entire_video');
  assert.equal(hit?.provenance, 'admin_verified');
  assert.equal(hit?.brand, 'Jordan');
  assert.equal(hit?.destination, 'https://www.nike.com/t/jordan-mens-polo-mbLOwHgG/II5381-417');
});

test('Stephen A. Jordan polo seed does not fire for non-shirt clicks in the same video', () => {
  for (const subcategory of ['watch', 'glasses', 'microphone']) {
    const miss = mappingMod.lookupVerifiedProductMapping({
      mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
      allowTestFixtures: false,
      platform: 'youtube',
      contentRef: 'wDev1WhWvQs',
      timestampMs: 120000,
      description: {
        ...stephenAJordanPolo,
        category: subcategory === 'microphone' ? 'electronics' : 'accessories',
        subcategory,
        style_attributes: [],
        shape_silhouette: [subcategory],
        search_terms: [subcategory],
      },
    });
    assert.equal(miss, null, `seed must not leak into ${subcategory}`);
  }
});


const luxMommyNeverfull = {
  category: 'accessories',
  subcategory: 'bag',
  brand_candidate: 'Louis Vuitton',
  model_candidate: 'Neverfull MM M20511',
  color: 'Midnight Fuchsia',
  material: 'coated canvas',
  style_attributes: ['Spring in the City', 'gradient monogram', 'tote'],
  visible_text: [],
  logos_markings: ['Louis Vuitton monogram'],
  distinctive_features: ['Neverfull MM'],
  hardware_details: [],
  shape_silhouette: ['tote'],
  search_terms: ['Louis Vuitton Neverfull MM Midnight Fuchsia M20511'],
  confidence: 0.98,
  identity_confidence: 0.95,
};

const luxMommyKeepall = {
  ...luxMommyNeverfull,
  model_candidate: 'Keepall Bandouliere 45 M13915',
  color: 'silver multicolor',
  material: 'iridescent coated canvas',
  style_attributes: ['Monogram Iridescent', 'rainbow effect'],
  distinctive_features: ['Keepall Bandouliere 45', 'earphones charm'],
  shape_silhouette: ['duffel'],
  search_terms: ['Louis Vuitton Keepall Bandouliere 45 Monogram Iridescent M13915'],
};

test('same video resolves Neverfull by product evidence without timestamps', () => {
  const hit = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: '313GzQj7TS8',
    timestampMs: 1000,
    description: luxMommyNeverfull,
  });
  assert.equal(hit?.product_id, 'M20511');
  const product = mappingMod.verifiedMappingProduct(hit);
  assert.equal(product.result_class, 'EXACT');
  assert.equal(product.price, '7999');
  assert.equal(product.currency, 'USD');
  assert.ok(product.image_reference?.includes('6ab1a7747b19910922bcdc98.jpg'));
});

test('same video resolves Keepall by product evidence without timestamps', () => {
  const hit = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: '313GzQj7TS8',
    timestampMs: 900000,
    description: luxMommyKeepall,
  });
  assert.equal(hit?.product_id, 'M13915');
  const product = mappingMod.verifiedMappingProduct(hit);
  assert.equal(product.result_class, 'EXACT');
  assert.equal(product.price, '5225');
  assert.equal(product.currency, 'USD');
  assert.ok(product.image_reference?.includes('6a03a4c13509d12a5bdd3136.jpg'));
});

test('same-video verified mappings fail closed when product evidence is ambiguous', () => {
  const hit = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: '313GzQj7TS8',
    description: {
      ...luxMommyNeverfull,
      model_candidate: null,
      color: '',
      material: '',
      style_attributes: [],
      distinctive_features: [],
      shape_silhouette: ['bag'],
      search_terms: ['Louis Vuitton bag'],
    },
  });
  assert.equal(hit, null);
});


test('LV review roster becomes same-video Product Memory without manual timestamps', () => {
  const rows = seedMod.alphaVerifiedCanonicalRowsForContent('youtube', '1auV6jxLh_Q');
  const ids = new Set(rows.map(({ mapping }) => mapping.product_id));
  assert.deepEqual(ids, new Set(['M3A350', 'N48280', 'N40952', 'N48279', 'M2A904', 'M3A947']));
  for (const { mapping, identity } of rows) {
    assert.equal(mapping.scope, 'entire_video');
    assert.equal(mapping.canonical_key, identity.canonical_key);
    assert.equal(mapping.track_id, identity.canonical_key);
    assert.ok(identity.merchant_refs.some((ref) => ref.image_reference));
  }
});

test('alpha Product Memory can nominate known products in a different video but excludes the current video roster', () => {
  const otherVideo = seedMod.alphaVerifiedCanonicalIdentitiesExcludingContent('youtube', 'some-new-video');
  assert.ok(otherVideo.some((identity) => identity.title.includes('Neverfull Inside Out MM')));
  assert.ok(otherVideo.some((identity) => identity.merchant_refs.some((ref) => ref.item_id === 'N40952')));

  const sameVideo = seedMod.alphaVerifiedCanonicalIdentitiesExcludingContent('youtube', '1auV6jxLh_Q');
  assert.equal(sameVideo.some((identity) => identity.merchant_refs.some((ref) => ref.item_id === 'N40952')), false);
});


test('current LV review video inherits the verified roster as candidates without timestamps', () => {
  const rows = seedMod.alphaVerifiedCanonicalRowsForContent('youtube', 'KbWTwHNR0_E');
  const ids = new Set(rows.map(({ mapping }) => mapping.product_id));
  assert.deepEqual(ids, new Set(['M3A350', 'N48280', 'N40952', 'N48279', 'M2A904', 'M3A947']));
  assert.ok(rows.every(({ mapping }) => mapping.content_ref === 'KbWTwHNR0_E'));
});


test('Handbagholic partner roster exposes ten creator-verified LV candidates for the video', () => {
  const rows = seedMod.alphaVerifiedCanonicalRowsForContent('youtube', 'n9u8ynhBdSo');
  const ids = new Set(rows.map(({ mapping }) => mapping.product_id));
  assert.deepEqual(ids, new Set([
    'FP-1977706',
    'M28392',
    'FP-1925620',
    'FP-1981368',
    'FP-1983129',
    'M2A078',
    'M14526',
    'POSH-6a3f49685919e011180b400c',
    'M46784',
    'FP-1985008',
  ]));
  assert.ok(rows.every(({ mapping }) => mapping.scope === 'entire_video'));
  assert.ok(rows.every(({ mapping }) => mapping.provenance === 'creator_verified'));
  assert.ok(rows.every(({ mapping, identity }) => mapping.track_id === identity.canonical_key));
});

test('Handbagholic roster does not turn a generic Louis Vuitton bag description into an automatic verified hit', () => {
  const hit = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'n9u8ynhBdSo',
    timestampMs: 500000,
    description: {
      category: 'accessories',
      subcategory: 'bag',
      brand_candidate: 'Louis Vuitton',
      model_candidate: null,
      color: 'brown',
      material: 'coated canvas',
      style_attributes: ['monogram canvas'],
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram'],
      distinctive_features: [],
      hardware_details: [],
      shape_silhouette: ['bag'],
      search_terms: ['Louis Vuitton monogram bag'],
      confidence: 0.95,
      identity_confidence: 0.2,
    },
  });
  assert.equal(hit, null);
});

test('Handbagholic High Rise Bumbag can resolve from explicit model evidence', () => {
  const hit = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'n9u8ynhBdSo',
    timestampMs: 760000,
    description: {
      category: 'accessories',
      subcategory: 'bag',
      brand_candidate: 'Louis Vuitton',
      model_candidate: 'High Rise Bumbag M46784',
      color: 'brown',
      material: 'coated canvas',
      style_attributes: ['monogram canvas', 'belt bag'],
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram'],
      distinctive_features: ['front zipper', 'adjustable canvas strap'],
      hardware_details: [],
      shape_silhouette: ['bumbag'],
      search_terms: ['Louis Vuitton High Rise Bumbag M46784'],
      confidence: 0.99,
      identity_confidence: 0.98,
    },
  });
  assert.equal(hit?.product_id, 'M46784');
  assert.equal(hit?.provenance, 'creator_verified');
});


test('Handbagholic partner roster narrows candidates by appearance window without turning time into identity', () => {
  const flower = seedMod.alphaVerifiedCanonicalRowsForContent('youtube', 'n9u8ynhBdSo', 288420);
  assert.deepEqual(flower.map(({ mapping }) => mapping.product_id), ['FP-1925620']);
  assert.ok(flower[0]?.mapping.image_reference?.includes('42edbf9959473e53ec1c92e1c8327770.jpg'));

  const trunkie = seedMod.alphaVerifiedCanonicalRowsForContent('youtube', 'n9u8ynhBdSo', 620046);
  assert.deepEqual(trunkie.map(({ mapping }) => mapping.product_id), ['M14526']);
  assert.ok(trunkie[0]?.mapping.image_reference?.includes('M14526_PM1_Worn'));

  const gap = seedMod.alphaVerifiedCanonicalRowsForContent('youtube', 'n9u8ynhBdSo', 320000);
  assert.deepEqual(gap, []);
});

test('candidate appearance windows remain candidate-only: generic frame evidence does not become direct Exact', () => {
  const hit = mappingMod.lookupVerifiedProductMapping({
    mappings: seedMod.ALPHA_VERIFIED_PRODUCT_SEEDS,
    allowTestFixtures: false,
    platform: 'youtube',
    contentRef: 'n9u8ynhBdSo',
    timestampMs: 620046,
    description: {
      category: 'accessories',
      subcategory: 'bag',
      brand_candidate: 'Louis Vuitton',
      model_candidate: 'Petite Malle',
      color: 'brown',
      material: 'coated canvas',
      style_attributes: ['monogram canvas'],
      visible_text: [],
      logos_markings: ['Louis Vuitton monogram'],
      distinctive_features: ['S-lock'],
      hardware_details: ['gold-tone hardware'],
      shape_silhouette: ['trunk-style shoulder bag'],
      search_terms: ['Louis Vuitton trunk bag'],
      confidence: 0.95,
      identity_confidence: 0.7,
    },
  });
  // scope remains entire_video and multiple partner identities exist, so timestamp
  // cannot directly assert M14526; Product Memory + image verification must earn it.
  assert.equal(hit, null);
});


test('configured multi-product roster can be canonicalized without code-specific seed logic', () => {
  const partner = loadModule(resolve(here, '../src/partner-roster.ts'));
  const mappings = mappingMod.parseVerifiedProductMappings(JSON.stringify([
    {
      platform: 'youtube',
      content_ref: 'https://www.youtube.com/watch?v=partner-video',
      scope: 'entire_video',
      candidate_window_start_ms: 1000,
      candidate_window_end_ms: 5000,
      object_type: 'bag',
      brand: 'Louis Vuitton',
      product_id: 'A',
      title: 'Partner Product A',
      destination: 'https://example.com/a',
      provenance: 'creator_verified'
    },
    {
      platform: 'youtube',
      content_ref: 'partner-video',
      scope: 'entire_video',
      candidate_window_start_ms: 6000,
      candidate_window_end_ms: 9000,
      object_type: 'bag',
      brand: 'Louis Vuitton',
      product_id: 'B',
      title: 'Partner Product B',
      destination: 'https://example.com/b',
      provenance: 'creator_verified'
    }
  ]));

  const aRows = partner.verifiedRosterCanonicalRowsForContent(mappings, 'youtube', 'partner-video', 3000);
  assert.deepEqual(aRows.map(({ mapping }) => mapping.product_id), ['A']);
  assert.equal(aRows[0].mapping.track_id, aRows[0].identity.canonical_key);

  const bRows = partner.verifiedRosterCanonicalRowsForContent(mappings, 'youtube', 'https://www.youtube.com/watch?v=partner-video', 7000);
  assert.deepEqual(bRows.map(({ mapping }) => mapping.product_id), ['B']);

  const allRows = partner.verifiedRosterCanonicalRowsForContent(mappings, 'youtube', 'partner-video');
  assert.deepEqual(new Set(allRows.map(({ mapping }) => mapping.product_id)), new Set(['A', 'B']));
});
