import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const server = readFileSync(resolve(here, '../src/server.ts'), 'utf8');

test('verified merchant offers collapse into one canonical Exact card', () => {
  assert.match(server, /const exactEvidence = \[\.\.\.metadataExact, \.\.\.visualExact, \.\.\.rememberedExact\]/);
  assert.match(server, /const exactProducts = dedupeProducts\(\[canonicalExact, \.\.\.visualAlternatives\]\)/);
  assert.doesNotMatch(server, /dedupeProducts\(\[canonicalProduct, \.\.\.metadataExact, \.\.\.visualExact, \.\.\.rememberedExact/);
});

test('canonical Exact card inherits verified image and fresh offer price without duplicating the identity', () => {
  assert.match(server, /image_reference: canonicalProduct\.image_reference[\s\S]*mapping\.image_reference[\s\S]*imagedExact\?\.image_reference[\s\S]*sourceImage/);
  assert.match(server, /price: canonicalProduct\.price \?\? pricedExact\?\.price \?\? null/);
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
