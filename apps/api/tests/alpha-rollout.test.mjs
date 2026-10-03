import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const worker = loadModule(new URL('../src/server.ts', import.meta.url).pathname, { TextDecoder }).default;
const alphaAccess = loadModule(new URL('../src/alpha-access.ts', import.meta.url).pathname, { TextDecoder });
const installId = '123e4567-e89b-12d3-a456-426614174000';
const post = (env, headers = {}) => worker.fetch(new Request('https://api.test/resolve-products', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: '{}',
}), env);

test('alpha kill switch stops paid product work before request parsing', async () => {
  const response = await post({ ALPHA_ENABLED: 'false' });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.reason, 'ALPHA_DISABLED');
  assert.equal(payload.retryable, false);
});

test('deployed alpha guardrails require the anonymous install id', async () => {
  const response = await post({ ALPHA_INSTALL_RATE_LIMITER: { async limit() { return { success: true }; } } });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).reason, 'ALPHA_INSTALL_ID_REQUIRED');
});

test('per-install rate limit blocks runaway Scoop requests', async () => {
  const response = await post(
    { ALPHA_INSTALL_RATE_LIMITER: { async limit({ key }) { assert.equal(key, installId); return { success: false }; } } },
    { 'x-scoop-install-id': installId },
  );
  assert.equal(response.status, 429);
  assert.equal((await response.json()).reason, 'ALPHA_INSTALL_RATE_LIMIT');
});

test('global rate limit blocks aggregate alpha runaway usage', async () => {
  const response = await post(
    {
      ALPHA_INSTALL_RATE_LIMITER: { async limit() { return { success: true }; } },
      ALPHA_GLOBAL_RATE_LIMITER: { async limit({ key }) { assert.equal(key, 'alpha-global'); return { success: false }; } },
    },
    { 'x-scoop-install-id': installId },
  );
  assert.equal(response.status, 429);
  assert.equal((await response.json()).reason, 'ALPHA_GLOBAL_RATE_LIMIT');
});


test('monthly invite cap blocks the 101st Scoop across installs', async () => {
  const secret = 'test-alpha-secret';
  const invite = await alphaAccess.createAlphaInvite({ ALPHA_INVITE_SECRET: secret }, 'crm-test-user', 30, 2);
  const ledger = {
    idFromName(name) { assert.equal(name, 'alpha-access-v1'); return name; },
    get() {
      return {
        async fetch(input, init) {
          const path = new URL(input).pathname;
          const body = JSON.parse(init.body);
          assert.equal(body.invite_id, 'crm-test-user');
          if (path === '/authorize') return Response.json({ authorized: true });
          if (path === '/consume-monthly') {
            assert.equal(body.limit, 100);
            return Response.json({ allowed: false, used: 100 });
          }
          return Response.json({}, { status: 404 });
        },
      };
    },
  };
  const response = await post(
    {
      ALPHA_INVITE_REQUIRED: 'true',
      ALPHA_INVITE_SECRET: secret,
      ALPHA_ACCESS_LEDGER: ledger,
    },
    {
      'x-scoop-install-id': installId,
      'x-scoop-alpha-token': invite.token,
    },
  );
  assert.equal(response.status, 429);
  const payload = await response.json();
  assert.equal(payload.reason, 'ALPHA_MONTHLY_LIMIT');
  assert.equal(payload.used, 100);
  assert.equal(payload.limit, 100);
  assert.equal(payload.retryable, false);
});
