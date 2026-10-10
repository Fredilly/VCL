import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { scopedPartnerRosterCandidates } = loadModule(resolve(here, '../src/partner-roster.ts'));

const row = (key, {start=0,end=100,variant=null}={}) => ({
  mapping:{ candidate_window_start_ms:start, candidate_window_end_ms:end },
  identity:{ canonical_key:key, variant_id:variant },
});
test('active partner scope excludes stale unversioned memory but preserves legitimate imported variants',()=>{
  const partner=[row('current')];
  const durable=[row('stale'),row('imported',{variant:'v2'}),row('current')];
  assert.equal(JSON.stringify(scopedPartnerRosterCandidates({
    partner,durable,timestamp_ms:50
  }).map(x=>x.identity.canonical_key)),JSON.stringify(['imported','current']));
});
test('durable variants remain eligible without active scoped partner window',()=>{
  assert.deepEqual(scopedPartnerRosterCandidates({
    partner:[],durable:[row('variant',{variant:'v2'})],timestamp_ms:50
  }).map(x=>x.identity.canonical_key)),JSON.stringify(['variant']));
});
test('out-of-window partner candidate cannot assert identity',()=>{
  assert.deepEqual(scopedPartnerRosterCandidates({
    partner:[row('old',{start:0,end:100})],
    durable:[row('old',{start:0,end:100})],timestamp_ms:500
  })),JSON.stringify([]));
});
