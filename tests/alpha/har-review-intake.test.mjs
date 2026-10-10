import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewIntake } from '../../tools/build-scoop-review-intake.mjs';
const url=p=>'https://api.test'+p;
const frame=Buffer.from([255,216,255,217]).toString('base64');
function item(path,t,request,response={}) {
 return {startedDateTime:t,request:{url:url(path),method:'POST',
   postData:{text:JSON.stringify(request)}},
   response:{content:{text:JSON.stringify(response)}}};
}
test('same-order joined intake preserves frame hash, clicked point, and unreviewed truth',()=>{
 const har={log:{entries:[
  item('/locate-selection','2026-10-10T00:00:00Z',{point:{x:.2,y:.8}}),
  item('/resolve-products','2026-10-10T00:00:02Z',{
   source_image:'data:image/jpeg;base64,'+frame,
   context:{timestamp_ms:4200},description:{model_candidate:'Petite Malle'}
  },{products:[{title:'Side Trunk',result_class:'EXACT'}]})
 ]}};
 const m=buildReviewIntake(har,'/unused');
 assert.equal(m.total,1);
 assert.equal(m.paired_clicks,1);
 assert.deepEqual(m.cases[0].input.click,{x:.2,y:.8});
 assert.match(m.cases[0].input.frames[0].sha256,/^[a-f0-9]{64}$/);
 assert.equal(m.cases[0].observation.vision_model_hypothesis,'Petite Malle');
 assert.equal(m.cases[0].truth,'UNREVIEWED');
 assert.equal(m.cases[0].expected_class,null);
 assert.equal(m.status,'REVIEW_REQUIRED_NOT_BENCHMARK_READY');
});
test('missing image blocks index join rather than attributing wrong click to source',()=>{
 const har={log:{entries:[item('/resolve-products','2026-10-10T00:00:02Z',{
  source_image:'invalid',context:{timestamp_ms:1}
 })]}};
 const m=buildReviewIntake(har,'/unused');
 assert.equal(m.status,'BLOCKED_INCOMPLETE_CORRELATION');
});
