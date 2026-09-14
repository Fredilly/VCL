import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';
const { mergeFrameEvidence, analyzeWithNearbyFrames, parseEvidenceFrames } = loadModule(new URL('../src/multi-frame-evidence.ts', import.meta.url).pathname);
const { normalizeObjectDescription } = loadModule(new URL('../src/types.ts', import.meta.url).pathname);
const image = 'data:image/png;base64,aGVsbG8=';
const primary = (extra = {}) => normalizeObjectDescription({ category: 'apparel', subcategory: 'shirt', color: 'blue',
  style_attributes: ['long sleeve'], confidence: 0.9, evidence_confidence: { color: 0.95, style_attributes: 0.9, subcategory: 0.5 }, ...extra });
const observation = (extra = {}) => ({ same_object_confidence: 0.98, identity_support: true,
  description: primary({ brand_candidate: 'Example', visible_text: ['Example'], color: '', style_attributes: [],
    evidence_confidence: { brand_candidate: 0.95, visible_text: 0.96 }, ...extra }) });
const frame = { id: 'next', timestamp: 10.5, offset: 0.5 };
const plain = (value) => JSON.parse(JSON.stringify(value));

test('single-frame fallback preserves the original hypothesis', () => {
  const result = mergeFrameEvidence(primary(), 10, []);
  const { multi_frame, ...description } = result;
  assert.deepEqual(plain(description), plain(primary()));
  assert.equal(multi_frame.frames_used, 1);
  assert.equal(multi_frame.changed_hypothesis, false);
});

test('strong readable neighboring logo improves identity with source provenance', () => {
  const result = mergeFrameEvidence(primary(), 10, [{ frame, observation: observation() }]);
  assert.equal(result.brand_candidate, 'Example');
  assert.equal(result.color, 'blue');
  assert.equal(result.multi_frame.changed_hypothesis, true);
  assert.equal(result.multi_frame.field_sources.brand_candidate, 'next');
  assert.equal(result.multi_frame.field_sources.color, 'current');
  assert.equal(result.multi_frame.frames[1].offset, 0.5);
  assert.match(result.search_terms[0], /Example/);
});

test('weak conflict and unknown cannot overwrite strong color or sleeves', () => {
  const weak = observation({ color: 'red', style_attributes: ['short sleeve'], evidence_confidence: { color: 0.5, style_attributes: 0.4 } });
  const result = mergeFrameEvidence(primary(), 10, [{ frame, observation: weak }]);
  assert.equal(result.color, 'blue');
  assert.deepEqual(plain(result.style_attributes), ['long sleeve']);
  assert.equal(result.multi_frame.changed_hypothesis, false);
  const unknown = mergeFrameEvidence(primary(), 10, [{ frame, observation: observation({ color: 'unknown', evidence_confidence: { color: 1 } }) }]);
  assert.equal(unknown.color, 'blue');
  assert.equal(unknown.multi_frame.frames[1].contributions.find(c => c.field === 'color').decision, 'unknown');
});

test('strong conflicting frames preserve the primary and disclose the conflict', () => {
  const result = mergeFrameEvidence(primary(), 10, [{ frame, observation: observation({ color: 'red', evidence_confidence: { color: 0.99 } }) }]);
  assert.equal(result.color, 'blue');
  assert.equal(result.multi_frame.frames[1].contributions.find(c => c.field === 'color').decision, 'preserve_stronger_or_conflicting_evidence');
});

test('strong evidence improves weak subtype and structural details without confidence voting', () => {
  const next = observation({ subcategory: 'polo', shape_silhouette: ['collared neckline'], hardware_details: ['three buttons'],
    evidence_confidence: { subcategory: 0.95, shape_silhouette: 0.95, hardware_details: 0.95 } });
  const result = mergeFrameEvidence(primary(), 10, [{ frame, observation: next }]);
  assert.equal(result.subcategory, 'polo');
  assert.deepEqual(plain(result.hardware_details), ['three buttons']);
  assert.equal(result.confidence, 0.9);
});

test('scene cuts and ambiguous same-object matches contribute nothing', () => {
  const result = mergeFrameEvidence(primary(), 10, [{ frame, observation: { ...observation(), same_object_confidence: 0.7 } }]);
  assert.equal(result.brand_candidate, null);
  assert.equal(result.multi_frame.frames_contributing, 1);
});

test('a larger surrounding object cannot donate its identity even with overconfident same-object output', () => {
  const selected = primary({ category: 'Accessories', subcategory: 'Wristwatch', style_attributes: [], color: 'silver' });
  const surrounding = observation({ category: 'Apparel', subcategory: 'T-shirt', brand_candidate: 'North Studio',
    visible_text: ['NORTH STUDIO'], evidence_confidence: { brand_candidate: 0.99, visible_text: 0.99 } });
  const result = mergeFrameEvidence(selected, 10, [{ frame, observation: surrounding }]);
  assert.equal(result.brand_candidate, null);
  assert.equal(result.subcategory, 'Wristwatch');
  assert.equal(result.multi_frame.changed_hypothesis, false);
  assert.equal(result.multi_frame.frames[1].contributions.find(c => c.field === 'brand_candidate').decision, 'category_conflict');
});

test('repeated neighboring agreement alone cannot inflate identity confidence', () => {
  const selected = primary({ brand_candidate: 'Example', identity_confidence: 0.6 });
  const result = mergeFrameEvidence(selected, 10, [{ frame, observation: observation({ visible_text: [],
    evidence_confidence: { brand_candidate: 0.99 } }) }]);
  assert.equal(result.identity_confidence, 0.6);
});

test('conflicting sleeves cannot enter through a different descriptive field', () => {
  const result = mergeFrameEvidence(primary(), 10, [{ frame, observation: observation({ shape_silhouette: ['short sleeves'],
    evidence_confidence: { shape_silhouette: 0.98 } }) }]);
  assert.deepEqual(plain(result.shape_silhouette), []);
  assert.deepEqual(plain(result.style_attributes), ['long sleeve']);
});

test('ungrounded identity and other-brand model clues are rejected', () => {
  const guess = { ...observation(), identity_support: false };
  assert.equal(mergeFrameEvidence(primary(), 10, [{ frame, observation: guess }]).brand_candidate, null);
  const source = primary({ brand_candidate: 'Original', model_candidate: 'One' });
  const result = mergeFrameEvidence(source, 10, [{ frame, observation: observation({ model_candidate: 'Other Two',
    evidence_confidence: { brand_candidate: 0.99, model_candidate: 0.99, visible_text: 0.99 } }) }]);
  assert.equal(result.brand_candidate, 'Original');
  assert.equal(result.model_candidate, 'One');
});

test('one failed nearby analysis preserves primary and usable other-frame evidence', async () => {
  let calls = 0;
  const provider = { async analyzeNearbyFrame() { if (++calls === 1) throw new Error('timeout with sensitive payload'); return observation(); } };
  const result = await analyzeWithNearbyFrames(provider, image, primary(), 10,
    [{ id: 'previous', timestamp: 9.5, offset: -0.5, dataUrl: image }, { ...frame, dataUrl: image }]);
  assert.equal(calls, 2);
  assert.equal(result.brand_candidate, 'Example');
  assert.equal(result.multi_frame.frames_used, 2);
  assert.equal(result.multi_frame.frames[1].status, 'analysis_failed');
  assert.ok(!JSON.stringify(result).includes('data:image'));
  assert.ok(!JSON.stringify(result).includes('sensitive payload'));
});

test('all nearby failures and unsupported adapters fall back cleanly', async () => {
  for (const provider of [{}, { async analyzeNearbyFrame() { throw new Error('failure'); } }]) {
    const result = await analyzeWithNearbyFrames(provider, image, primary(), 10, [{ ...frame, dataUrl: image }]);
    assert.equal(result.multi_frame.frames_used, 1);
    assert.equal(result.multi_frame.changed_hypothesis, false);
  }
});

test('complete primary identity still permits requested comparisons without confidence voting', async () => {
  const baseline = primary({ brand_candidate: 'Known', model_candidate: 'One', identity_confidence: 0.95 });
  let calls = 0;
  const provider = { async analyzeNearbyFrame() { calls++; return { same_object_confidence: 0.99, identity_support: true, description: baseline }; } };
  const result = await analyzeWithNearbyFrames(provider, image, baseline, 10, [{ ...frame, dataUrl: image }]);
  assert.equal(calls, 1);
  assert.equal(result.multi_frame.frames_used, 2);
  assert.equal(result.identity_confidence, baseline.identity_confidence);
  assert.equal(result.confidence, baseline.confidence);
  assert.equal(result.multi_frame.changed_hypothesis, false);
});

test('frame contract enforces count, unique slots, image and relative timestamps', () => {
  const valid = { ...frame, dataUrl: image };
  assert.equal(parseEvidenceFrames([valid], 10).length, 1);
  for (const invalid of [[valid, valid], [valid, valid, valid], [{ ...valid, offset: NaN }], [{ ...valid, timestamp: 40 }],
    [{ ...valid, offset: 1 }], [{ ...valid, dataUrl: 'https://example.org/image.jpg' }]]) assert.throws(() => parseEvidenceFrames(invalid, 10));
});
