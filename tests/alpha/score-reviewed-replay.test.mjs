import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreReviewedReplay} from '../../tools/score-reviewed-replay.mjs';
const c=(id,truth,true_sku,returned_top_canonical_key,returned_top_class,reviewed_by='reviewer')=>({id,truth,true_sku,reviewed_by,observation:{returned_top_canonical_key,returned_top_class}});
test('false Exact for wrong SKU and out of roster, with signed denominator',()=>{
 const r=scoreReviewedReplay({cases:[c('1','IN_ROSTER','A','B','EXACT'),c('2','OUT_OF_ROSTER',null,'C','EXACT'),c('3','IN_ROSTER','A','A','EXACT'),c('4','IN_ROSTER','A','B','SIMILAR'),c('5','IN_ROSTER','A',null,'EXACT','')]});
 assert.equal(r.total,5);assert.equal(r.signed,4);assert.equal(r.evaluated,4);assert.equal(r.false_exact,2);assert.equal(r.exact_precision,1/3);
});
test('titles do not prove a canonical match',()=>{
 const r=scoreReviewedReplay({cases:[{id:'x',truth:'IN_ROSTER',true_sku:'A',reviewed_by:'r',observation:{returned_top_title:'Similar to A',returned_top_class:'EXACT'}}]});
 assert.equal(r.evaluated,0);assert.equal(r.rows[0].outcome,'UNSCORABLE_MISSING_RESULT_ID');
});
test('NONE and ambiguity abstention',()=>{
 const r=scoreReviewedReplay({cases:[{id:'n',truth:'OUT_OF_ROSTER',reviewed_by:'r',observation:{result_count:0,returned_top_class:'NONE'}},{id:'a',truth:'AMBIGUOUS',reviewed_by:'r',observation:{result_count:0,returned_top_class:'NONE'}}]});
 assert.equal(r.evaluated,2);assert.equal(r.false_exact,0);
});
test('duplicates rejected',()=>assert.throws(()=>scoreReviewedReplay({cases:[{id:'1'},{id:'1'}]}),/duplicate/));

test('out-of-roster EXACT without a canonical key is a false Exact; labeled non-EXACT is not',()=>{
 const o=(id,cls)=>({id,truth:'OUT_OF_ROSTER',reviewed_by:'r',observation:{returned_top_title:'Some bag',returned_top_class:cls}});
 const r=scoreReviewedReplay({cases:[o('a','EXACT'),o('b','RELATED'),o('c','NONE')]});
 assert.equal(r.false_exact,1);assert.equal(r.rows[1].outcome,'OUT_OF_ROSTER_LABELED_NON_EXACT');assert.equal(r.rows[2].outcome,'CORRECT_ABSTENTION');
});
test('signed exact_verdict scores an EXACT that has no canonical key',()=>{
 const e=(id,v)=>({id,truth:'IN_ROSTER',true_sku:'fam:x',reviewed_by:'r',exact_verdict:v,observation:{returned_top_title:'t',returned_top_class:'EXACT'}});
 const r=scoreReviewedReplay({cases:[e('a','MISMATCH'),e('b','MATCH'),e('c','')]});
 assert.equal(r.false_exact,1);assert.equal(r.correct_sku,1);assert.equal(r.rows[2].outcome,'UNSCORABLE_MISSING_RESULT_ID');
});
