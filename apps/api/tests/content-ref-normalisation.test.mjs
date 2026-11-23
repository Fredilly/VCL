import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const mod = loadModule(new URL('../src/server.ts', import.meta.url).pathname);

test('a prefixed reference from the extension matches the imported roster key', () => {
  assert.equal(mod.normaliseContentRef('youtube', 'youtube:n9u8ynhBdSo'), 'n9u8ynhBdSo');
  assert.equal(mod.normaliseContentRef('youtube', 'n9u8ynhBdSo'), 'n9u8ynhBdSo');
});

test('another platform prefix is not stripped by the wrong platform', () => {
  assert.equal(mod.normaliseContentRef('tiktok', 'youtube:abc'), 'youtube:abc');
  assert.equal(mod.normaliseContentRef('tiktok', 'tiktok:abc'), 'abc');
});

test('no platform means no stripping', () => {
  assert.equal(mod.normaliseContentRef(null, 'youtube:abc'), 'youtube:abc');
});
