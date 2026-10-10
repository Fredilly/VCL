import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateHarClicks } from '../../tools/correlate-scoop-har-clicks.mjs';
const entry=(path,date,data,response={})=>({
 startedDateTime:date,
 request:{method:'POST',url:'https://example.test'+path,postData:{text:JSON.stringify(data)}},
 response:{content:{text:JSON.stringify(response)}}
});
test('nearest preceding clicks are paired but never promoted into ground truth',()=>{
 const har={log:{entries:[
  entry('/locate-selection','2026-10-10T00:00:00.000Z',{point:{x:.2,y:.7}},{x:.1,y:.5,width:.3,height:.2}),
  entry('/resolve-products','2026-10-10T00:00:02.000Z',{context:{content_ref:'youtube:abc',timestamp_ms:42},description:{model_candidate:'Petite Malle'}})
 ]}};
 const x=correlateHarClicks(har);
 assert.equal(x.click_pairs,1);assert.deepEqual(x.cases[0].click,{x:.2,y:.7});
 assert.equal(x.cases[0].hypothesis,'Petite Malle');
 assert.equal(x.cases[0].review.canonical_sku,null);
 assert.equal(x.cases[0].correlation,'SEQUENTIAL_UNVERIFIED');
});
test('stale or future localization cannot be quietly bound to a resolution',()=>{
 const har={log:{entries:[
  entry('/locate-selection','2026-10-10T00:00:00.000Z',{point:{x:.5,y:.5}}),
  entry('/resolve-products','2026-10-10T00:03:00.000Z',{context:{}}),
  entry('/locate-selection','2026-10-10T00:04:00.000Z',{point:{x:.5,y:.5}})
 ]}};
 const x=correlateHarClicks(har);
 assert.equal(x.click_pairs,0);assert.equal(x.unmatched_localizations,2);
});
