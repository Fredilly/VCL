import test from 'node:test';
import assert from 'node:assert/strict';
import { harvestReplayRequests, replayHar } from '../../tools/replay-scoop-har-resolver.mjs';
const frame='data:image/jpeg;base64,/9j/2Q==';
const har={log:{entries:[{startedDateTime:'2026-10-10T00:00:00Z',
 request:{url:'https://api.example.test/resolve-products',method:'POST',
 postData:{text:JSON.stringify({description:{model_candidate:'Petite Malle'},
 source_image:frame,context:{content_ref:'youtube:handbags',timestamp_ms:636600},
 telemetry:{event_id:'old-event',session_id:'old-session',interaction_started_at:1791555203775}})}},
 response:{content:{text:JSON.stringify({products:[{title:'Trunkie',identity_key:'sku:trunkie',result_class:'SIMILAR'}],state:'RESULTS'})}}}]}};
test('replay retains recorded pixels privately and does not claim SKU truth',async()=>{
 const cases=harvestReplayRequests(har,{contentRef:'handbags'});
 assert.equal(cases.length,1);
 assert.equal(cases[0].request.source_image,frame);
 assert.notEqual(cases[0].request.telemetry.event_id,'old-event');
 assert.notEqual(cases[0].request.telemetry.session_id,'old-session');
 assert.equal(typeof cases[0].request.telemetry.interaction_started_at,'number');
 let calls=0;
 const result=await replayHar(har,{endpoint:'https://api.example.test/resolve-products',
  fetchImpl:async (_url,options)=>{
   calls++;
   const body=JSON.parse(options.body);
   assert.equal(body.source_image,frame);
   return {ok:true,json:async()=>({products:[{title:'Trunkie',result_class:'SIMILAR',identity_key:'sku:trunkie'}],state:'RESULTS'})};
  }});
 assert.equal(calls,1);
 assert.equal(result.completed,1);
 assert.equal(result.evaluation,'UNLABELED_NO_ACCURACY_CLAIM');
 assert.equal(JSON.stringify(result).includes(frame),false);
 assert.equal(result.rows[0].current.top_identity,'sku:trunkie');
});
test('rejects unsafe endpoints and blocks silent HTTP failures',async()=>{
 await assert.rejects(replayHar(har,{endpoint:'http://api.example.test/resolve-products'}),/HTTPS/);
 const result=await replayHar(har,{endpoint:'https://api.example.test/resolve-products',
  fetchImpl:async()=>({ok:false,status:401})});
 assert.equal(result.rows[0].status,'HTTP_401');
 assert.equal(result.completed,0);
});

test('time and cost changes alone do not masquerade as SKU improvements',async()=>{
  const result=await replayHar(har,{endpoint:'https://api.example.test/resolve-products',
    fetchImpl:async()=>({ok:true,json:async()=>({
      state:'RESULTS',
      products:[{title:'Trunkie',identity_key:'sku:trunkie',result_class:'SIMILAR'}],
      latency_ms:9999, cost_usage:{total_cost_usd:0.123}
    })})});
  assert.equal(result.changed,0);
});
