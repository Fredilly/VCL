import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mod = loadModule(resolve(here, '../src/subrequest-ledger.ts'));

test('the ledger charges every kind of outbound request to one budget', () => {
  const ledger = mod.createSubrequestLedger(10);
  for (const kind of ['page', 'image', 'redirect', 'model', 'commerce']) {
    assert.equal(ledger.reserve(kind), true, kind);
  }
  assert.equal(ledger.total(), 5);
  assert.equal(ledger.remaining(), 5);
  assert.equal(ledger.reserve('image', 5), true);
  assert.equal(ledger.reserve('model'), false, 'a request past the limit is refused');
  assert.equal(ledger.total(), 10);
  assert.equal(ledger.exhausted(), true);
  const snapshot = ledger.snapshot();
  assert.equal(JSON.stringify(snapshot.spent), JSON.stringify({ page: 1, image: 6, redirect: 1, model: 1, commerce: 1 }));
  assert.equal(snapshot.total, 10);
});

test('the ledger refuses a batch that would overflow instead of partially spending it', () => {
  const ledger = mod.createSubrequestLedger(4);
  assert.equal(ledger.reserve('image', 3), true);
  assert.equal(ledger.reserve('image', 3), false);
  assert.equal(ledger.spent.image, 3, 'a refused reservation spends nothing');
  assert.equal(ledger.reserve('image'), true);
  assert.equal(ledger.exhausted(), true);
});

test('a ledger-free budget still behaves like the old pool (legacy callers)', () => {
  const ledger = mod.createSubrequestLedger(0);
  assert.equal(ledger.limit, mod.DEFAULT_SUBREQUEST_LIMIT, 'a non-positive limit falls back to the default');
});
