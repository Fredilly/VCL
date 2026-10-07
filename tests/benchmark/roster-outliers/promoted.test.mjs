import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendPromotionFixtures } from '../../../tools/partner-learning.mjs';
import { promotedCases } from './promoted.mjs';
import { onDecision } from '../product-tracks/run.mjs';
import { cases } from './corpus.mjs';

test('review exports append frozen production-resolver cases with no hand-edited corpus', () => {
  const directory = mkdtempSync(join(tmpdir(), 'scoop-promotion-'));
  try {
    const fixture = { ...cases.find(row => row.id === 'multi-a'), id: 'correction:event/result' };
    const [path] = appendPromotionFixtures([fixture], directory);
    const content = readFileSync(path, 'utf8');
    const loaded = promotedCases(directory);
    assert.equal(loaded.length, 1);
    assert.equal(onDecision(loaded[0]).track_id, fixture.expected_class);
    appendPromotionFixtures([fixture], directory);
    assert.equal(readFileSync(path, 'utf8'), content);
    assert.throws(() => appendPromotionFixtures([{ ...fixture, expected_class: fixture.candidates[1].identity.canonical_key }], directory), /Frozen correction changed/);
    assert.equal(promotedCases(directory).length, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
