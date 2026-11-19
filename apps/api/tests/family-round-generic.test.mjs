import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mod = loadModule(resolve(here, '../src/same-video-verified-reuse.ts'));

// Nothing below names a real product, brand or category pair: these are shapes a
// partner list takes, not fixtures from one video.

const row = (id, identity) => ({
  mapping: {
    platform: 'youtube', content_ref: 'video-Z', product_id: id, title: identity.title ?? id,
    canonical_key: id, track_id: id, object_type: identity.object_type ?? 'item',
    brand: identity.brand ?? null, trusted_observations: [], scope: 'entire_video',
  },
  identity: { canonical_key: id, title: id, brand: null, model: null, object_type: 'item', visible_text: [], merchant_refs: [], ...identity },
});

const comparison = (similarity) => ({ source: {}, candidate: {}, similarity, confidence: .95, matching_details: ['shared detail'] });

test('families group unrelated brands and categories separately', () => {
  const rows = [
    row('a1', { family: 'Alpha', object_type: 'bag', brand: 'BrandOne' }),
    row('a2', { family: 'Alpha', object_type: 'bag', brand: 'BrandOne' }),
    row('b1', { family: 'Beta', object_type: 'shoe', brand: 'BrandTwo' }),
    row('b2', { family: 'Beta', object_type: 'shoe', brand: 'BrandTwo' }),
    row('c1', { family: 'Gamma', object_type: 'vacuum', brand: 'BrandThree' }),
    row('d1', { family: 'Delta', object_type: 'headphones', brand: 'BrandFour' }),
  ];
  const families = new Set(rows.map(({ identity }) => mod.rosterFamilyKey(identity)));
  assert.equal(families.size, 4);
  const comparisons = new Map([
    ['a1', comparison(.3)], ['b1', comparison(.88)], ['c1', comparison(.2)], ['d1', comparison(.1)],
  ]);
  // The caller passes one representative per family, as the resolver does.
  const representatives = rows.filter(({ identity }) => ['a1', 'b1', 'c1', 'd1'].includes(identity.canonical_key));
  const advancing = mod.advancingRosterFamilies({ candidates: representatives, comparisons });
  assert.equal([...advancing].sort().join(','), 'beta');
});

test('a family whose representative could not be compared is never eliminated', () => {
  const rows = [
    row('a1', { family: 'Alpha' }), row('b1', { family: 'Beta' }), row('c1', { family: 'Gamma' }),
  ];
  // Only Alpha produced a usable comparison; Beta and Gamma must survive.
  const advancing = mod.advancingRosterFamilies({
    candidates: rows, comparisons: new Map([['a1', comparison(.9)]]),
  });
  assert.equal([...advancing].sort().join(','), 'alpha,beta,gamma');
});

test('families fall back to model, then distinctive title words, when a list states no family', () => {
  const byModel = mod.rosterFamilyKey({ canonical_key: 'x', title: 'whatever', brand: null, model: 'M-1001', object_type: 'bag', visible_text: [], normalized_fingerprint: '', provenance: 'admin_verified', verified_at: '', merchant_refs: [] });
  const byTitle = mod.rosterFamilyKey({ canonical_key: 'y', title: 'Linen overshirt jacket', brand: null, model: null, object_type: 'apparel', visible_text: [], normalized_fingerprint: '', provenance: 'admin_verified', verified_at: '', merchant_refs: [] });
  assert.equal(byModel, 'm 1001');
  assert.match(byTitle, /linen/);
});

test('messy duplicate labels do not collapse two different products into one family', () => {
  const rows = [
    row('v1', { family: 'Alpha', variant_id: 'size unstated' }),
    row('v2', { family: 'Alpha', variant_id: 'no listing found' }),
    row('v3', { family: 'Beta', variant_id: 'size unstated' }),
  ];
  const families = new Set(rows.map(({ identity }) => mod.rosterFamilyKey(identity)));
  assert.equal(families.size, 2, 'the same messy note in two families is still two families');
});

test('a crowded roster abstains instead of naming a front-runner it cannot separate', () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(`s${i}`, { family: 'Alpha', variant_id: `V${i}` }));
  const comparisons = new Map(rows.map(({ identity }, i) => [identity.canonical_key, comparison(i === 0 ? .95 : .85)]));
  const decision = mod.resolveSameVideoReuse({
    description: { category: 'bag', subcategory: 'bag', brand_candidate: null, model_candidate: null, color: null, material: null,
      visible_text: [], logos_markings: [], distinctive_features: [], shape_silhouette: [], style_attributes: [],
      search_terms: [], confidence: .9, identity_confidence: 0, evidence_confidence: { contextual_text: 0 } },
    candidates: rows, comparisons, require_complete_comparisons: true,
  });
  assert.equal(decision.reason, 'ambiguous');
  assert.equal(decision.mapping, null);
});

test('an out-of-roster click confirms nothing, even with one high score', () => {
  const rows = [row('a1', { family: 'Alpha' }), row('a2', { family: 'Alpha' })];
  // Every comparison is weak: nothing passes the strict check, so no family is
  // nominated and no identity is asserted.
  const comparisons = new Map([['a1', comparison(.4)], ['a2', comparison(.35)]]);
  const decision = mod.resolveSameVideoReuse({
    description: { category: 'bag', subcategory: 'bag', brand_candidate: null, model_candidate: null, color: null, material: null,
      visible_text: [], logos_markings: [], distinctive_features: [], shape_silhouette: [], style_attributes: [],
      search_terms: [], confidence: .9, identity_confidence: 0, evidence_confidence: { contextual_text: 0 } },
    candidates: rows, comparisons, require_complete_comparisons: true,
  });
  assert.equal(decision.mapping, null);
  assert.notEqual(decision.reason, 'visual_confirmed');
});
