import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRosterAcceptance } from '../../tools/sku-roster-acceptance.mjs';
const make = i => ({ id: String(i), reviewed_by: 'human', truth:'IN_ROSTER', true_sku:'sku-'+i,
  result:{ canonical_sku:'sku-'+i, class:'SIMILAR', destination:'https://merchant.example/item/'+i, latency_ms:10000 } });
test('requires at least 20 independently reviewed clicks', () => {
  assert.equal(evaluateRosterAcceptance({ cases:Array.from({length:6},(_,i)=>make(i)) }).status, 'INSUFFICIENT_REVIEWED_CLICKS');
});
test('20 correct clickable results pass without demanding EXACT', () => {
  const result=evaluateRosterAcceptance({cases:Array.from({length:20},(_,i)=>make(i))});
  assert.equal(result.status,'PASS');assert.equal(result.correct,20);assert.equal(result.false_exact,0);
});
test('out-of-roster false Exact never passes', () => {
  const cases=Array.from({length:20},(_,i)=>make(i));
  cases[1]={id:'1',reviewed_by:'human',truth:'OUT_OF_ROSTER',result:{canonical_sku:'wrong',class:'EXACT'}};
  const r=evaluateRosterAcceptance({cases});assert.equal(r.false_exact,1);assert.equal(r.status,'FAIL_FALSE_EXACT');
});
test('wrong SIMILAR and missing shopping link are product failures',()=>{
  const cases=Array.from({length:20},(_,i)=>make(i));
  cases[0].result.canonical_sku='sibling-variant';
  delete cases[1].result.destination;
  const r=evaluateRosterAcceptance({cases});assert.equal(r.status,'MEASURED_WITH_PRODUCT_FAILURES');assert.equal(r.wrong,1);assert.equal(r.missing_destination,1);
});
test('missing human review never counts as success',()=>{
  const cases=Array.from({length:20},(_,i)=>make(i)); delete cases[0].reviewed_by;
  assert.equal(evaluateRosterAcceptance({cases}).status,'INSUFFICIENT_REVIEWED_CLICKS');
});
test('duplicate case IDs rejected',()=>assert.throws(()=>evaluateRosterAcceptance({cases:[make(0),make(0)]}),/duplicate/));
