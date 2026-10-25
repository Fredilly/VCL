import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';
const { confirmSameVideoVisual } = loadModule(new URL('../src/same-video-verified-reuse.ts', import.meta.url).pathname);
const decision = {mapping:{product_id:'generic-variant',canonical_key:'variant:1'},canonical_key:'variant:1',confidence:.8,reason:'fingerprint_candidate',requires_visual:true};
const o=(value,basis='image')=>({value,confidence:.97,basis});
const cmp=(source,candidate)=>({source,candidate,similarity:.98,confidence:.97,matching_details:['matching closure geometry and strap hardware']});
test('independent material contradiction vetoes otherwise strong visual Exact',()=>{
 const result=confirmSameVideoVisual(decision,cmp({material:o('leather')},{material:o('canvas')}));
 assert.equal(result.mapping,null);assert.equal(result.reason,'visual_rejected');
});
test('unknown material is uncertainty, not invented contradiction',()=>{
 const result=confirmSameVideoVisual(decision,cmp({material:o('leather')},{}));
 assert.equal(result.reason,'visual_confirmed');
});
test('same material still permits verified Exact',()=>{
 const result=confirmSameVideoVisual(decision,cmp({material:o('leather')},{material:o('leather','metadata')}));
 assert.equal(result.reason,'visual_confirmed');
});
test('low-confidence material discrepancy does not become a hard veto',()=>{
 const candidate=o('canvas');candidate.confidence=.55;
 const result=confirmSameVideoVisual(decision,cmp({material:o('leather')},{material:candidate}));
 assert.equal(result.reason,'visual_confirmed');
});
