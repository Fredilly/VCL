import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const config = await readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8');

test('Scoop cleanup aborts active work and removes overlay/result UI', () => {
  assert.match(content, /function cleanupScoopUi\(\)/);
  assert.match(content, /activeCapture\?\.abort\(\)/);
  assert.match(content, /document\.getElementById\(OVERLAY_ID\)\?\.remove\(\)/);
  assert.match(content, /document\.getElementById\(RESULT_ID\)\?\.remove\(\)/);
});

test('navigation and fresh overlay paths clean up stale Scoop UI', () => {
  assert.match(content, /function showOverlay\(\)\s*\{\s*cleanupScoopUi\(\)/);
  assert.match(content, /addEventListener\('pagehide', cleanupScoopUi/);
  assert.match(content, /addEventListener\('beforeunload', cleanupScoopUi/);
  assert.match(content, /event\.key === 'Escape'\) cleanupScoopUi\(\)/);
});

test('extension storage permission is explicit and narrowly documented', () => {
  assert.match(config, /permissions:\s*\['activeTab', 'storage'\]/);
});
