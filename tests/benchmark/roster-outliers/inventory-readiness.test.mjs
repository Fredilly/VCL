import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { auditVideoInventory } from './inventory-readiness.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../fixtures/partner-regressions/n9u8ynhBdSo-inventory.json', import.meta.url), 'utf8'));
test('actual Handbagholic inventory does not pretend its links have verified images', () => {
  const audit = auditVideoInventory(manifest);
  assert.equal(audit.inspected_offers, 10);
  assert.equal(audit.ready_offers, 0);
  assert.equal(audit.variant_mentions, 43);
  assert.equal(audit.status, 'NOT_READY');
  assert.equal(audit.issues.filter(x => x.code === 'IMAGE_UNVERIFIED').length, 10);
});
test('one verified source does not silently mark others ready', () => {
  const key = manifest.sections[0].reference_offer.merchant_item_id;
  const image = { image_fetched: true, variant_match_verified: true, storage_permitted: true,
    image_sha256: 'a'.repeat(64), canonical_variant_verified: true };
  const audit = auditVideoInventory(manifest, {[key]:image});
  assert.equal(audit.ready_offers, 1);
  assert.equal(audit.unready_offers, 9);
  assert.equal(audit.status, 'NOT_READY');
});
test('image retrieval alone cannot establish variant identity or image rights', () => {
  const key = manifest.sections[0].reference_offer.merchant_item_id;
  const audit = auditVideoInventory(manifest, {[key]:{image_fetched:true,image_sha256:'b'.repeat(64)}});
  assert.equal(audit.ready_offers, 0);
  assert.equal(audit.offers[0].state, 'IDENTITY_UNVERIFIED');
});
test('duplicate source listing IDs are not silently collapsed', () => {
  const input = structuredClone(manifest);
  input.sections[1].reference_offer.merchant_item_id = input.sections[0].reference_offer.merchant_item_id;
  assert.ok(auditVideoInventory(input).issues.some(issue=>issue.code === 'DUPLICATE_MERCHANT_ID'));
});
