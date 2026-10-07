import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadModule } from './helpers/load-ts.mjs';
const roster = loadModule(new URL('../src/partner-roster.ts', import.meta.url).pathname);
const seeds = loadModule(new URL('../src/alpha-verified-product-seeds.ts', import.meta.url).pathname);
const reuse = loadModule(new URL('../src/same-video-verified-reuse.ts', import.meta.url).pathname);
const fallback = loadModule(new URL('../src/roster-fallback.ts', import.meta.url).pathname);
const query = loadModule(new URL('../src/commerce.ts', import.meta.url).pathname);
const fixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/partner-regressions/2026-10-07-family-drift.json', import.meta.url)));
const visual = (score) => ({ source: { subtype: { value: 'bag', confidence: .98, basis: 'image' } }, candidate: { subtype: { value: 'bag', confidence: .98, basis: 'image' } }, similarity: score, confidence: .98, matching_details: ['matching rivet placement and flap construction'] });

test('active roster window vetoes a stale whole-video track even when its visual score is high', () => {
  const recorded = fixture.selections.find(row => row.har_entry_index === 53);
  const partner = seeds.alphaVerifiedCanonicalRowsForContent('youtube', 'youtube:n9u8ynhBdSo', recorded.timestamp_ms);
  assert.ok(partner.some(row => row.mapping.product_id === 'M14526'));
  const canonical_key = 'legacy:wrong-malle';
  const stale = { mapping: { ...partner[0].mapping, canonical_key, track_id: canonical_key, product_id: 'wrong', candidate_window_start_ms: undefined, candidate_window_end_ms: undefined }, identity: { ...partner[0].identity, canonical_key, title: 'Wrong older sibling', variant_id: null } };
  const candidates = roster.scopedPartnerRosterCandidates({ partner, durable: [stale], timestamp_ms: recorded.timestamp_ms });
  assert.equal(candidates.some(row => row.identity.canonical_key === canonical_key), false);
  const comparisons = new Map([[canonical_key, visual(.99)], ...partner.map(row => [row.identity.canonical_key, visual(.5)])]);
  assert.equal(reuse.resolveSameVideoReuse({ description: recorded.description, candidates, comparisons }).mapping, null);
  const correct = partner.find(row => row.mapping.product_id === 'M14526');
  comparisons.set(correct.identity.canonical_key, visual(.98));
  assert.equal(reuse.resolveSameVideoReuse({ description: recorded.description, candidates, comparisons }).canonical_key, correct.identity.canonical_key);
});

test('explicit imported variants remain available; out-of-window durable variants do not', () => {
  const partner = seeds.alphaVerifiedCanonicalRowsForContent('youtube', 'youtube:n9u8ynhBdSo', 627761);
  const imported = { mapping: { ...partner[0].mapping, canonical_key: 'imported', track_id: 'imported', candidate_window_start_ms: undefined, candidate_window_end_ms: undefined }, identity: { ...partner[0].identity, canonical_key: 'imported', variant_id: 'explicit-catalog-sku' } };
  assert.ok(roster.scopedPartnerRosterCandidates({ partner, durable: [imported], timestamp_ms: 627761 }).some(row => row.identity.canonical_key === 'imported'));
  imported.mapping.candidate_window_start_ms = 1000; imported.mapping.candidate_window_end_ms = 2000;
  assert.equal(roster.scopedPartnerRosterCandidates({ partner, durable: [imported], timestamp_ms: 627761 }).some(row => row.identity.canonical_key === 'imported'), false);
});

test('recorded CarryAll/chain-strap misses do not send hallucinated Noe or Capucines into fallback search', () => {
  for (const row of fixture.selections.filter(row => row.har_entry_index !== 53)) {
    const safe = fallback.rosterFallbackDescription(row.description);
    assert.equal(safe.model_candidate, null);
    const queries = query.buildProductQueryVariants(safe);
    assert.ok(queries.length);
    assert.ok(queries.every(q => !/\b(capucines|noe)\b/i.test(q.query)));
  }
});

test('readable object identity and high-confidence adjacent catalog labels survive fallback', () => {
  const original = fixture.selections[0].description;
  const marked = { ...original, visible_text: [original.model_candidate] };
  assert.equal(fallback.rosterFallbackDescription(marked).model_candidate, original.model_candidate);
  const adjacent = { ...original, contextual_text: [original.model_candidate], evidence_confidence: { ...original.evidence_confidence, contextual_text: .9 } };
  assert.equal(fallback.rosterFallbackDescription(adjacent).model_candidate, original.model_candidate);
});
