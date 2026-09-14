import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';
const { verifyCandidate } = loadModule(new URL('../src/candidate-verification.ts', import.meta.url).pathname);
const { normalizeObjectDescription } = loadModule(new URL('../src/types.ts', import.meta.url).pathname);
function fixture(brand = 'Aster', model = 'Q42') {
  const description = normalizeObjectDescription({ category: 'shoes', subcategory: 'sneakers', color: 'blue',
    brand_candidate: brand, model_candidate: model, visible_text: [brand, model], confidence: .97, identity_confidence: .97 });
  const evidence = Object.fromEntries(Object.entries({ subtype: 'sneakers', color: 'blue', brand, model })
    .map(([key, value]) => [key, { value, confidence: .97, basis: 'image' }]));
  return { description, candidate: { id: '1', title: `${brand} ${model} blue sneakers`, metadata: { brand, model, color: 'blue' },
    provider: 'ebay', provenance: 'ebay:browse', result_class: 'SIMILAR' }, comparison: {
    source: structuredClone(evidence), candidate: structuredClone(evidence), confidence: .97, similarity: .97,
    matching_details: ['curved toe overlay geometry', 'raised heel panel construction'] } };
}
const verify = f => verifyCandidate(f.description, f.candidate, f.comparison).product;
test('moderate visual agreement stays useful SIMILAR even with matching reported brand/model', () => {
  for (const similarity of [.65, .8, .85, .89]) {
    const f = fixture(); f.comparison.similarity = similarity;
    assert.equal(verify(f)?.result_class, 'SIMILAR', String(similarity));
  }
});
test('high similarity cannot compensate for missing readable source identity or low field confidence', () => {
  for (const change of [
    f => { f.description.visible_text = []; },
    f => { f.description.visible_text = ['Aster']; },
    f => { f.description.evidence_confidence = { visible_text: .4 }; },
    f => { f.comparison.source.model.confidence = .6; },
    f => { f.comparison.source.model.basis = 'metadata'; },
    f => { delete f.comparison.source.model; },
  ]) {
    const f = fixture(); f.comparison.similarity = 1; change(f);
    assert.equal(verify(f)?.result_class, 'SIMILAR');
  }
});
test('titles, copied guesses, brand-only geometry and provider choice cannot establish LIKELY', () => {
  for (const provider of ['ebay', 'etsy', 'brave', 'serpapi']) {
    const f = fixture(); f.candidate.provider = provider; f.candidate.provenance = `${provider}:fixture`;
    f.comparison.similarity = 1;
    f.candidate.metadata = { color: 'blue' };
    delete f.comparison.candidate.brand; delete f.comparison.candidate.model;
    assert.equal(verify(f)?.result_class, 'SIMILAR');
    f.description.model_candidate = null; f.description.visible_text = ['Aster'];
    delete f.comparison.source.model;
    assert.equal(verify(f)?.result_class, 'SIMILAR');
  }
});
test('strong grounded identity survives without construction details, across names and provider evidence paths', () => {
  for (const [brand, model] of [['Aster', 'Q42'], ['Boreal Works', 'RX 7'], ['Cirrus', 'Unit-15']]) {
    for (const path of ['catalog', 'pixels']) {
      const f = fixture(brand, model); f.comparison.matching_details = [];
      if (path === 'catalog') { delete f.comparison.candidate.brand; delete f.comparison.candidate.model; }
      else { f.candidate.metadata = { color: 'blue' }; f.candidate.title = 'Blue sneakers'; }
      assert.equal(verify(f)?.result_class, 'LIKELY');
    }
  }
});
test('strong visual floor is conjunctive with comparison confidence, never a replacement for identity', () => {
  const f = fixture(); f.comparison.similarity = .9; f.comparison.confidence = .9;
  assert.equal(verify(f)?.result_class, 'LIKELY');
  f.comparison.confidence = .89;
  assert.equal(verify(f)?.result_class, 'SIMILAR');
  f.comparison.confidence = .99; f.candidate.metadata.model = 'different model';
  assert.equal(verify(f)?.result_class, 'SIMILAR');
});
