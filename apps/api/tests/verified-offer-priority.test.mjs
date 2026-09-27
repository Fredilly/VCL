import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const server = readFileSync(resolve(here, '../src/server.ts'), 'utf8');

test('remembered verified merchant offers are prioritized before visual alternatives', () => {
  const match = server.match(/dedupeProducts\(\[canonicalProduct, \.\.\.metadataExact, \.\.\.visualExact, \.\.\.rememberedExact, \.\.\.visualAlternatives\]\)/);
  assert.ok(match, 'verified merchant inventory must enter the capped result set before visual alternatives');
});

test('verified offer priority does not change VPM identity selection', () => {
  assert.match(server, /durableCanonicalProductIdentity\(visual\.env, mapping\.canonical_key\)/);
  assert.match(server, /identity_key: identityKey/);
});


test('re-promoting a known merchant offer reuses its canonical identity instead of forking a new VPM track', () => {
  assert.match(server, /canonicalIdentityHasMerchantOffer\(identity, incomingOfferRef\)/);
  assert.match(server, /const existingIdentity = hintedIdentity \?\? rememberedOfferIdentity/);
  assert.match(server, /merchant_refs: \[incomingOfferRef\]/);
});
