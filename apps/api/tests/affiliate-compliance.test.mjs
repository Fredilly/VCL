import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mod = loadModule(resolve(here, '../src/affiliate-compliance.ts'));

test('unknown or missing affiliate status fails closed', () => {
  assert.equal(mod.normalizeAffiliateComplianceStatus(undefined), 'DISABLED_IN_EXTENSION');
  assert.equal(mod.normalizeAffiliateComplianceStatus('surprise-mode'), 'DISABLED_IN_EXTENSION');
  assert.equal(mod.shouldRequestAffiliateTreatment(undefined), false);
  assert.equal(mod.shouldRequestAffiliateTreatment('PLAIN_LINK_ONLY'), false);
});

test('plain merchant URL wins unless adapter is explicitly compliant', () => {
  const input = {
    plain_url: 'https://merchant.example/product',
    affiliate_url: 'https://affiliate.example/tracked',
  };

  assert.equal(
    mod.resolveChromeMerchantDestination({ ...input, status: 'DISABLED_IN_EXTENSION' }),
    input.plain_url,
  );
  assert.equal(
    mod.resolveChromeMerchantDestination({ ...input, status: 'PLAIN_LINK_ONLY' }),
    input.plain_url,
  );
  assert.equal(
    mod.resolveChromeMerchantDestination({ ...input, status: 'COMPLIANT_ENABLED' }),
    input.affiliate_url,
  );
});

test('non-compliant mode never falls back to an affiliate-only URL', () => {
  assert.equal(
    mod.resolveChromeMerchantDestination({
      plain_url: null,
      affiliate_url: 'https://affiliate.example/tracked',
      status: 'DISABLED_IN_EXTENSION',
    }),
    null,
  );
});
