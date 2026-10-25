import test from 'node:test';
import assert from 'node:assert/strict';
import {rosterIds,validateLabel,exportLabels,applyLabels} from '../../tools/private-crop-review-core.mjs';
const roster={products:[{sku:'A'},{sku:'B'}]};
const item={case_id:'016',truth:'SKU',true_sku:'A',reviewed_by:'human',reviewed_at:'2026-10-25T00:00:00Z'};
test('only named roster SKUs are accepted',()=>{
 assert.deepEqual(rosterIds(roster),['A','B']);
 assert.throws(()=>validateLabel({...item,true_sku:'invented'},['A','B']),/roster/);
 assert.equal(validateLabel(item,['A','B']),true);
});
test('cannot stamp unreviewed or assign SKU to NONE',()=>{
 assert.throws(()=>validateLabel({...item,truth:'UNREVIEWED'},['A']),/Choose/);
 assert.throws(()=>validateLabel({...item,truth:'NONE'},['A']),/Only SKU/);
 assert.throws(()=>validateLabel({...item,truth:'UNKNOWN',true_sku:null},['A']),/Explain/);
});
test('merge emits runner truth and true_sku without changing unreviewed',()=>{
 const corpus={cases:[{id:'016',truth:'UNREVIEWED'},{id:'026',truth:'UNREVIEWED'}]};
 const labels=exportLabels(corpus.cases,{'016':item});
 const merged=applyLabels(corpus,labels,roster);
 assert.equal(merged.cases[0].truth,'IN_ROSTER');
 assert.equal(merged.cases[0].true_sku,'A');
 assert.equal(merged.cases[1].truth,'UNREVIEWED');
});
test('NONE and UNKNOWN remain distinct',()=>{
 const corpus={cases:[{id:'016'},{id:'026'}]};
 const l=exportLabels(corpus.cases,{
  '016':{...item,truth:'NONE',true_sku:null},
  '026':{...item,case_id:'026',truth:'UNKNOWN',true_sku:null,uncertainty_reason:'family_known_variant_unknown'}
 });
 const m=applyLabels(corpus,l,roster);
 assert.equal(m.cases[0].expected_class,'NONE');
 assert.equal(m.cases[1].expected_class,'UNKNOWN');
});
test('duplicate case IDs and foreign IDs rejected',()=>{
 const c={cases:[{id:'016'}]};
 assert.throws(()=>applyLabels(c,{cases:[item,item]},roster),/duplicate/);
 assert.throws(()=>applyLabels(c,{cases:[{...item,case_id:'999'}]},roster),/foreign/);
});
