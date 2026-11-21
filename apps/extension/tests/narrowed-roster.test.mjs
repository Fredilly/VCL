import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');

// The server sets both `hit: false` and `narrowed: true` for a roster that the
// family round narrowed, because the clicked variant may never have been
// compared. These assertions pin the client half of that contract: the Exact
// badge must be unreachable if either signal appears.

test('the Exact badge requires a hit that is not a narrowed roster', () => {
  assert.match(content, /narrowed\?: boolean;/);
  assert.match(content, /const narrowedRoster = commerce\.verified_mapping\?\.narrowed === true;/);
  assert.match(content, /commerce\.verified_mapping\?\.hit && !narrowedRoster/);
});

test('the badge text is only rendered inside the verified-product branch', () => {
  const badgeIndex = content.indexOf("exactBadge.textContent = '✓ Exact match'");
  const branchIndex = content.indexOf('if (verifiedProduct) {');
  assert.ok(badgeIndex > 0 && branchIndex > 0, 'both markers must exist');
  assert.ok(badgeIndex > branchIndex, 'the badge is created only when a verified product was chosen');
});

test('no other code path builds an Exact badge', () => {
  const occurrences = content.match(/✓ Exact match/g) ?? [];
  assert.equal(occurrences.length, 1, 'exactly one Exact badge string exists');
});
