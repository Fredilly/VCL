import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const files = [
  '../src/gemini-vision.ts',
  '../src/openrouter-vision.ts',
  '../src/groq-vision.ts',
  '../src/cloudflare-vision.ts',
  '../src/selection-target.ts',
  '../src/frame-evidence-prompt.ts',
  '../src/ocr-evidence.ts',
];

const sources = Object.fromEntries(await Promise.all(files.map(async (path) => [
  path,
  await readFile(new URL(path, import.meta.url), 'utf8'),
])));

test('all vision paths reject overlay and nearby-object text as product identity evidence', () => {
  for (const [path, source] of Object.entries(sources)) {
    assert.match(source, /lower third/i, path);
    assert.match(source, /watermark/i, path);
    assert.match(source, /(nearby|surrounding|unrelated) object/i, path);
  }
});

test('primary vision prompts forbid overlay text from driving identity/search', () => {
  for (const path of ['../src/gemini-vision.ts', '../src/openrouter-vision.ts', '../src/groq-vision.ts', '../src/cloudflare-vision.ts']) {
    const source = sources[path];
    assert.match(source, /brand_candidate/);
    assert.match(source, /model_candidate/);
    assert.match(source, /search_terms/);
    assert.match(source, /(must never influence|may influence)/i);
    assert.match(source, /(physically attached|physically part)/i);
  }
});

test('OCR recovery keeps genuine on-product text while excluding overlays', () => {
  const source = sources['../src/ocr-evidence.ts'];
  assert.match(source, /printed, stitched, embossed, engraved, labeled, or marked on the selected product/i);
  assert.match(source, /even when that text overlaps or crosses the selected product/i);
});
