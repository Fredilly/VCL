import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';
const { resolveProducts } = loadModule(new URL('../src/server.ts', import.meta.url).pathname);
const { normalizeObjectDescription } = loadModule(new URL('../src/types.ts', import.meta.url).pathname);

for (const type of ['watch', 'bag', 'sneakers', 'boots']) {
  test(`Spike 4f: singular/normalized ${type} remains eligible for Etsy`, async () => {
    let called = 0;
    const provider = { name: 'etsy', tier: 'primary', provider: { async search() { called++; return []; } } };
    const description = normalizeObjectDescription({ category: type, subcategory: type, confidence: .9 });
    await resolveProducts([provider], [{ query: type, category: type, subcategory: type, brand: null, model: null, attributes: [] }], description, {});
    assert.equal(called, 1, `${type} must not silently lose an eligible catalog provider`);
  });
}
for (const type of ['lamp', 'music player', 'laptop']) {
  test(`Spike 4f: ${type} does not broaden Etsy category routing`, async () => {
    let called = 0;
    const provider = { name: 'etsy', tier: 'primary', provider: { async search() { called++; return []; } } };
    const description = normalizeObjectDescription({ category: type, subcategory: type, confidence: .9 });
    await resolveProducts([provider], [{ query: type, category: type, subcategory: type, brand: null, model: null, attributes: [] }], description, {});
    assert.equal(called, 0);
  });
}
