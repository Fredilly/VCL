import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync(new URL('../../../tests/fixtures/partner-regressions/n9u8ynhBdSo-inventory.json', import.meta.url), 'utf8'));

test('video research survives with all original offers, discussion windows and unverified variants', () => {
  assert.equal(manifest.video.id, 'n9u8ynhBdSo');
  assert.equal(manifest.sections.length, 10);
  assert.equal(new Set(manifest.sections.map(s => s.reference_offer.merchant_item_id)).size, 10);
  assert.ok(manifest.sections.every(s => /^https:\/\//.test(s.reference_offer.url)));
  assert.ok(manifest.sections.every(s => s.discussion_window_ms[0] < s.discussion_window_ms[1]));
  assert.ok(manifest.sections.every(s => s.mentioned_variants.length && s.mentioned_variants.every(v => v.on_screen === 'unknown')));
  assert.ok(manifest.sections.reduce((count, s) => count + s.mentioned_variants.length, 0) >= 30);
  assert.ok(manifest.rules.some(rule => rule.includes('Never infer')));
});
