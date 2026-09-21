import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const mod = await loadModule('src/commerce-attribution.ts');
const secret = '0123456789abcdef0123456789abcdef';

test('creator mapping is server controlled', () => {
  assert.equal(mod.creatorForContent(JSON.stringify({ 'youtube:abc123': 'creator_001' }), 'youtube:abc123'), 'creator_001');
  assert.equal(mod.creatorForContent(JSON.stringify({ 'youtube:abc123': 'creator_001' }), 'youtube:other'), null);
});

test('signed attribution token survives verification and detects tampering', async () => {
  const issued = await mod.makeAttribution({
    secret,
    creator_id: 'creator_001',
    content_ref: 'youtube:abc123',
    event_id: 'evt_1',
    result_id: 'ebay_123',
    merchant: 'ebay',
    affiliate_network: 'ebay-epn',
  });
  const verified = await mod.verifyAttributionToken(secret, issued.attribution_token);
  assert.equal(verified.creator_id, 'creator_001');
  assert.equal(verified.event_id, 'evt_1');
  assert.equal(verified.result_id, 'ebay_123');
  assert.equal(verified.click_ref, issued.click_ref);
  await assert.rejects(() => mod.verifyAttributionToken(secret, issued.attribution_token.replace(/.$/, '0')));
});

test('transaction fixture reconciles to creator and preserves ledger states', async () => {
  const issued = await mod.makeAttribution({
    secret,
    creator_id: 'creator_002',
    content_ref: 'youtube:xyz987',
    event_id: 'evt_2',
    result_id: 'etsy_55',
    merchant: 'etsy',
    affiliate_network: 'awin',
  });
  const click = await mod.verifyAttributionToken(secret, issued.attribution_token);
  for (const state of ['pending', 'approved', 'reversed', 'paid']) {
    const ledger = mod.reconcileCommission([click], {
      click_ref: issued.click_ref,
      transaction_ref: `tx_${state}`,
      currency: 'usd',
      gross_commission: 12.5,
      creator_share: 5,
      state,
      occurred_at: '2026-09-21T12:00:00.000Z',
    });
    assert.equal(ledger.creator_id, 'creator_002');
    assert.equal(ledger.state, state);
    assert.equal(ledger.creator_share, 5);
  }
});
