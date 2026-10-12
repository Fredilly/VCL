import test from 'node:test';
import assert from 'node:assert/strict';
import { harvestReplayRequests, replayHar } from '../../tools/replay-scoop-har-resolver.mjs';
const frame='data:image/jpeg;base64,/9j/2Q==';
const har={log:{entries:[{startedDateTime:'2026-10-10T00:00:00Z',
 request:{url:'https://api.example.test/resolve-products',method:'POST',
 postData:{text:JSON.stringify({description:{model_candidate:'Petite Malle'},
 source_image:frame,context:{content_ref:'youtube:handbags',timestamp_ms:636600},vpm_observation_mode:null,
 telemetry:{event_id:'old-event',session_id:'old-session',interaction_started_at:1791555203775}})}},
 response:{content:{text:JSON.stringify({products:[{title:'Trunkie',identity_key:'sku:trunkie',result_class:'SIMILAR'}],state:'RESULTS'})}}}]}};
test('replay retains recorded pixels privately and does not claim SKU truth',async()=>{
 const cases=harvestReplayRequests(har,{contentRef:'handbags'});
 assert.equal(cases.length,1);
 assert.equal(cases[0].request.source_image,frame);
 assert.equal(Object.hasOwn(cases[0].request,'vpm_observation_mode'),true);
 assert.equal(cases[0].request.vpm_observation_mode,null);
 assert.notEqual(cases[0].request.telemetry.event_id,'old-event');
 assert.notEqual(cases[0].request.telemetry.session_id,'old-session');
 assert.equal(typeof cases[0].request.telemetry.interaction_started_at,'number');
 let calls=0;
 const result=await replayHar(har,{endpoint:'https://api.example.test/resolve-products',
  fetchImpl:async (_url,options)=>{
   calls++;
   const id=options.headers['x-scoop-install-id'];
   assert.match(id,/^[a-f0-9-]{36}$/i);
   assert.notEqual(id,'old-session');
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

test('HTTP 400 exposes only allowlisted validation fields and safe error codes',async()=>{
  const result=await replayHar(har,{endpoint:'https://api.example.test/resolve-products',
    fetchImpl:async()=>({ok:false,status:400,json:async()=>({
      code:'VALIDATION_FAILED',message:'private-image-data:secret',
      issues:[{path:['context','timestamp_ms'],message:'sensitive'},
        {path:['password'],message:'sensitive'}]
    })})});
  assert.equal(result.rows[0].status,'HTTP_400');
  assert.equal(result.rows[0].error_code,'VALIDATION_FAILED');
  assert.equal(JSON.stringify(result).includes('private-image-data'),false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.rows[0].validation_fields)),['context','timestamp_ms']);
});

test('HTTP 400 string messages classified without exposing message text',async()=>{
  const result=await replayHar(har,{endpoint:'https://api.example.test/resolve-products',
    maxCases:1,fetchImpl:async()=>({ok:false,status:400,json:async()=>({
      error:'Invalid request body with PRIVATE frame name: secret-123'
    })})});
  assert.equal(result.rows[0].status,'HTTP_400');
  assert.equal(result.rows[0].error_shape,'json_object');
  assert.equal(result.rows[0].error_category,'VALIDATION');
  assert.equal(JSON.stringify(result).includes('secret-123'),false);
});

test('report separates identity, confidence and offer count changes',async()=>{
  const result=await replayHar(har,{endpoint:'https://api.example.test/resolve-products',
    maxCases:1,fetchImpl:async()=>({ok:true,json:async()=>({
      products:[{identity_key:'sku:new',result_class:'SIMILAR',title:'New'}],state:'RESULTS'
    })})});
  assert.equal(result.identity_changed,1);
  assert.equal(result.confidence_changed,0);
  assert.equal(result.offers_changed,0);
  assert.equal(result.changed,1);
});
