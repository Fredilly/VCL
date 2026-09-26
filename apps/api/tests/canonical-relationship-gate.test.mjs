import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';
import { canonicalRelationshipCases } from './fixtures/canonical-relationships.mjs';

const file = (name) => fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url));
const { classifyCanonicalRelationship, verifyCandidate } = loadModule(file('candidate-verification'));

test('canonical relationship frozen gate: Exact / Similar / Related stay conservative', (t) => {
  let exactClaims = 0;
  let falseExact = 0;
  const observed = [];

  for (const item of canonicalRelationshipCases) {
    const product = verifyCandidate(item.description, item.candidate, item.comparison).product;
    assert.ok(product, `${item.id}: fixture must remain eligible`);
    observed.push({ id: item.id, expected: item.expected, actual: product.relationship });
    if (product.relationship === 'EXACT') {
      exactClaims++;
      if (item.expected !== 'EXACT') falseExact++;
    }
    assert.equal(product.relationship, item.expected, item.id);
  }

  assert.ok(exactClaims > 0, 'gate must exercise a real EXACT claim');
  assert.equal(falseExact, 0, 'false EXACT is a hard failure');
  t.diagnostic(JSON.stringify({ version: 1, cases: observed.length, exactClaims, falseExact, observed }));
});


test('shared per-candidate classifier can produce Exact, Similar and Related in one result set', () => {
  const relationships = canonicalRelationshipCases.slice(0, 3).map((item) =>
    classifyCanonicalRelationship(item.description, item.candidate, item.comparison));
  assert.deepEqual(relationships, ['EXACT', 'SIMILAR', 'RELATED']);
});

test('shared per-candidate classifier agrees with normal verification relationship', () => {
  for (const item of canonicalRelationshipCases) {
    const verified = verifyCandidate(item.description, item.candidate, item.comparison).product;
    assert.ok(verified, item.id);
    assert.equal(
      classifyCanonicalRelationship(item.description, item.candidate, item.comparison),
      verified.relationship,
      item.id,
    );
  }
});
