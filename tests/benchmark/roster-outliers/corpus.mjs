import { shirt, lookalike, cases as vpmCases } from '../product-tracks/corpus.mjs';

// Frozen evidence-level fixtures. These are NOT claims of pixel/model accuracy.
const plain = {
  ...vpmCases[0].description, visible_text: [], logos_markings: [],
  distinctive_features: [], model_candidate: null, search_terms: ['black t-shirt'],
};
const copy = (item, key, changes = {}) => ({
  mapping: { ...item.mapping, canonical_key: key, track_id: key, product_id: key, title: changes.title ?? item.identity.title },
  identity: { ...item.identity, canonical_key: key, ...changes },
});
const sized = copy(shirt, 'shirt:large', { title: 'Building Is My Love Language Tee Large' });
const trimmed = copy(shirt, 'shirt:trim', { distinctive_features: ['contrast collar trim'] });
const seasonal = copy(shirt, 'shirt:2025', { title: 'Building Is My Love Language Tee 2025' });
const blue = copy(shirt, 'shirt:blue', { color: 'blue' });
const visual = (similarity, detail = 'tonal embossed chest lettering', sourceColor = 'black', candidateColor = 'black') => ({
  source: { subtype: { value: 't-shirt', confidence: .98, basis: 'image' }, color: { value: sourceColor, confidence: .96, basis: 'image' } },
  candidate: { subtype: { value: 't-shirt', confidence: .98, basis: 'image' }, color: { value: candidateColor, confidence: .96, basis: 'image' } },
  similarity, confidence: .96, matching_details: [detail],
});
const make = (id, scenario, candidates, description, expected, comparisons = {}, truth = expected ? 'IN_ROSTER' : 'OUT_OF_ROSTER') => ({
  id, scenario, timestamp_ms: 4500, candidates, description, comparisons,
  expected_track_id: expected, truth, expected_class: expected ?? 'NONE',
});
const key = shirt.identity.canonical_key;
const other = lookalike.identity.canonical_key;
export const cases = [
  make('single-x', 'single_sku', [shirt], vpmCases[0].description, key),
  make('single-not-x', 'single_sku', [shirt], { ...plain, color: 'red' }, null, { [key]: visual(.6, 'different chest design', 'red') }),
  make('multi-a', 'multi_sku', [shirt, lookalike, blue, sized], plain, key, { [key]: visual(.97), [other]: visual(.6), 'shirt:blue': visual(.6), 'shirt:large': visual(.6) }),
  make('multi-b', 'multi_sku', [shirt, lookalike, blue, sized], vpmCases[5].description, other),
  make('multi-c', 'colorways', [shirt, lookalike, blue, sized], { ...plain, color: 'blue' }, 'shirt:blue', { 'shirt:blue': visual(.97, 'tonal embossed chest lettering', 'blue', 'blue') }),
  make('multi-d', 'near_size', [shirt, lookalike, blue, sized], plain, 'shirt:large', { 'shirt:large': visual(.97, 'large size label and chest construction'), [key]: visual(.6) }),
  make('comparison-none', 'comparison_outside_roster', [shirt, lookalike, blue, sized], { ...plain, color: 'red' }, null, { [key]: visual(.7, 'different garment', 'red') }),
  ...[
    ['size-unreadable', 'near_size', sized],
    ['trim-hidden', 'near_trim', trimmed],
    ['season-unreadable', 'near_season', seasonal],
    ['old-new-ambiguous', 'old_new', seasonal],
  ].map(([id, scenario, variant]) => make(id, scenario, [shirt, variant], vpmCases[0].description, null, {}, 'AMBIGUOUS')),
  make('old-new-visible', 'old_new', [shirt, seasonal], plain, 'shirt:2025', { [key]: visual(.7), 'shirt:2025': visual(.97, '2025 label and revised collar stitching') }),
  ...[
    ['reversed', .97, 'mirrored embossed lettering and seam placement'],
    ['worn', .96, 'embossed lettering and collar construction'],
    ['folded', .95, 'visible embossed lettering and collar seam'],
    ['partially_hidden', .95, 'visible embossed lettering and shoulder seam'],
    ['poor_lighting', .94, 'embossed chest lettering and collar seam'],
  ].map(([scenario, score, detail]) => make(`${scenario}-recoverable`, scenario, [shirt, lookalike], plain, key, { [key]: visual(score, detail), [other]: visual(.7) })),
  make('inside-out-unresolved', 'inside_out', [shirt, lookalike], plain, null, { [key]: visual(.6), [other]: visual(.6) }, 'AMBIGUOUS'),
  make('poor-light-unresolved', 'poor_lighting', [shirt, lookalike], plain, null, { [key]: { ...visual(.97), confidence: .4 } }, 'AMBIGUOUS'),
  make('screen-image-other-discussed', 'screen_vs_speech', [shirt, lookalike], { ...vpmCases[0].description, contextual_text: ['Eating Is My Love Language'] }, key),
  // OCR contamination is intentionally preserved: visual disagreement must win.
  make('nearby-ocr-wrong-item', 'nearby_ocr', [shirt], vpmCases[0].description, null, { [key]: visual(.55, 'different chest print') }),
  make('wrong-roster-entry', 'wrong_roster', [shirt], { ...plain, color: 'white' }, null, { [key]: visual(.97, 'same text but different color', 'white') }),
  make('colorway-unknown', 'colorways', [shirt, blue], { ...plain, color: '' }, null, { [key]: visual(.96), 'shirt:blue': visual(.96) }, 'AMBIGUOUS'),
  make('accessory-merged', 'overlapping_accessories', [shirt, lookalike], plain, null, { [key]: visual(.65), [other]: visual(.64) }, 'AMBIGUOUS'),
  make('accessory-recoverable', 'overlapping_accessories', [shirt, lookalike], plain, key, { [key]: visual(.96, 'chest lettering and collar outside strap'), [other]: visual(.6) }),
];

const pochette = copy(shirt, 'bag:pochette', {
  title: 'Louis Vuitton Pochette Metis Monogram Canvas', brand: 'Louis Vuitton',
  object_type: 'bag', color: null, model: null, visible_text: ['LOUIS VUITTON PARIS'],
  logos_markings: ['LOUIS VUITTON PARIS'], shape_silhouette: ['rectangular flap bag'],
});
pochette.mapping.object_type = 'bag';
pochette.mapping.brand = 'Louis Vuitton';
cases.push(make('white-alma-not-pochette', 'alma_pochette', [pochette], {
  ...plain, category: 'Handbags', subcategory: 'bag', brand_candidate: 'Louis Vuitton',
  model_candidate: 'Alma', color: 'White and Beige', material: 'Canvas and Leather',
  visible_text: ['LOUIS VUITTON', 'PARIS'], logos_markings: ['Louis Vuitton'],
  distinctive_features: ['braided top handle'], shape_silhouette: ['dome satchel'],
  search_terms: ['Louis Vuitton Alma'],
}, null));

export const requiredScenarios = [
  'single_sku', 'multi_sku', 'comparison_outside_roster', 'near_size', 'near_trim',
  'near_season', 'reversed', 'worn', 'folded', 'partially_hidden', 'inside_out',
  'poor_lighting', 'old_new', 'screen_vs_speech', 'nearby_ocr', 'wrong_roster',
  'colorways', 'overlapping_accessories', 'alma_pochette',
];
