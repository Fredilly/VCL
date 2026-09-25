import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mod = loadModule(resolve(here, '../src/admin-access.ts'));

function ledger() {
  const values = new Map();
  const storage = {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, structuredClone(value)); },
  };
  return new mod.AdminAccessLedger({ storage });
}

async function post(instance, path, body) {
  return await instance.fetch(new Request(`https://admin-access${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

test('bootstrap creates a revocable admin session without exposing stored plaintext session token', async () => {
  const instance = ledger();
  const bootstrap = await post(instance, '/bootstrap', { label: 'Owner' });
  assert.equal(bootstrap.status, 200);
  const session = await bootstrap.json();
  assert.equal(session.label, 'Owner');
  assert.match(session.session_token, /^scoop_admin_/);

  const status = await post(instance, '/status', { token: session.session_token });
  assert.deepEqual(await status.json(), { admin: true, admin_id: session.admin_id, label: 'Owner' });
});

test('an authenticated admin can mint a one-time invite for a separate admin session', async () => {
  const instance = ledger();
  const owner = await (await post(instance, '/bootstrap', { label: 'Owner' })).json();
  const invite = await (await post(instance, '/invite', { session_token: owner.session_token })).json();
  assert.match(invite.code, /^scoop_admin_invite_/);

  const second = await (await post(instance, '/redeem', { code: invite.code, label: 'Reviewer' })).json();
  assert.equal(second.label, 'Reviewer');
  assert.notEqual(second.admin_id, owner.admin_id);
  assert.notEqual(second.session_token, owner.session_token);

  const reused = await post(instance, '/redeem', { code: invite.code, label: 'Other' });
  assert.equal(reused.status, 403);
});
