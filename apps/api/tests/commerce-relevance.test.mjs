import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

// The commerce list is where a correct match is usually lost: an unrelated bag with
// a price on it reads as an offer for the thing the user clicked.
const mod = loadModule(new URL('../src/server.ts', import.meta.url).pathname);
const tokens = (value) => mod.identityTokens(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test('brand and house pattern carry no identity', () => {
  // Size suffixes (MM/PM) are below the token length floor on purpose: this gate
  // filters at family level and must not pretend to resolve a size.
  assert.ok(same(tokens('Louis Vuitton Monogram Side Trunk MM').sort(), ['side', 'trunk']));
});

test('an unrelated bag does not share identity with the match', () => {
  const anchor = tokens('Side Trunk MM');
  assert.equal(mod.sharesIdentity({ title: 'Louis Vuitton Neverfull MM Monogram' }, anchor), false);
  assert.equal(mod.sharesIdentity({ title: 'Louis Vuitton Speedy Bandouliere 25' }, anchor), false);
  assert.equal(mod.sharesIdentity({ title: 'Louis Vuitton Side Trunk' }, anchor), true);
  assert.equal(mod.sharesIdentity({ title: 'LV trunk bag side trunk pm' }, anchor), true);
});

test('with no anchor, nothing is filtered out', () => {
  assert.equal(mod.sharesIdentity({ title: 'anything at all' }, []), true);
});
